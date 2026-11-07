import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { SOL_MINT } from "@/lib/market/universe";
import { emptyState } from "@/lib/store";
import type { AppState } from "@/lib/types";
import { applyAgentCommand, hashAgentCode, issueAgentGrant, mintAgentCode, normalizeAgentCode, revokeAgentGrant } from "./agent";
import { agentPermissionMemo, clampAgentMinutes, permissionSignatureMatches } from "./agentPermission";
import { agentGrantFromSignedBytes, agentSessionFromTransaction, buildAgentPermissionTransaction, signAgentPermission } from "@/lib/solana/agentSign";
import type { WalletSession } from "@/lib/solana/wallet";

function permit(state: AppState, minutes = 60, now = Date.now()): AppState {
  const owner = Keypair.generate();
  const delegate = Keypair.generate();
  const expiresAt = new Date(now + minutes * 60_000).toISOString();
  const tx = buildAgentPermissionTransaction({
    owner: owner.publicKey,
    delegate: delegate.publicKey.toBase58(),
    expiresAt,
    blockhash: Keypair.generate().publicKey.toBase58(),
  });
  tx.sign(owner);
  const agentSession = agentSessionFromTransaction(tx, {
    owner: owner.publicKey.toBase58(),
    delegate: delegate.publicKey.toBase58(),
    expiresAt,
    minutes,
  });
  agentSession.signedAt = new Date(now).toISOString();
  return { ...state, bot: { ...state.bot, agentSession } };
}

function book(): AppState {
  const state = emptyState();
  state.portfolio.cashUsd = 200;
  state.portfolio.equityUsd = 200;
  return state;
}

describe("grok agent code", () => {
  it("stores a hash and never the code", async () => {
    const code = mintAgentCode();
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    assert.equal(normalizeAgentCode(` ${code.toLowerCase()} `), code.replace("-", ""));
    const issued = await issueAgentGrant(book());
    assert.equal(issued.ok, true);
    if (!issued.ok) return;
    assert.notEqual(issued.state.agentGrants?.[0]?.codeHash, issued.code);
    assert.equal(issued.state.agentGrants?.[0]?.codeHash, await hashAgentCode(issued.code));
    assert.equal(JSON.stringify(issued.state).includes(issued.code), false);
  });

  it("rejects a wrong code and a revoked code", async () => {
    const issued = await issueAgentGrant(book());
    assert.equal(issued.ok, true);
    if (!issued.ok) return;
    const wrong = await applyAgentCommand(issued.state, { code: "AAAA-BBBB", action: "connect" });
    assert.equal(wrong.ok, false);
    if (wrong.ok) return;
    assert.equal(wrong.status, 401);
    const revoked = revokeAgentGrant(issued.state, issued.state.agentGrants?.[0]?.id ?? "");
    const again = await applyAgentCommand(revoked, { code: issued.code, action: "connect" });
    assert.equal(again.ok, false);
    if (again.ok) return;
    assert.match(again.error, /revoked/);
  });

  it("buys and sells a watchlist name on the practice book", async () => {
    const issued = await issueAgentGrant(book());
    assert.equal(issued.ok, true);
    if (!issued.ok) return;
    const bought = await applyAgentCommand(permit(issued.state), {
      code: issued.code,
      action: "buy",
      symbol: "sol",
      usd: 25,
      price: 100,
    });
    assert.equal(bought.ok, true);
    if (!bought.ok || !bought.state) return;
    assert.equal(bought.fill?.action, "buy");
    assert.equal(bought.fill?.symbol, "SOL");
    assert.ok((bought.state.portfolio.cashUsd ?? 0) < 200);
    assert.equal(bought.state.positions[0]?.symbol, "SOL");
    assert.equal(bought.state.positions[0]?.mint, SOL_MINT);
    assert.equal(bought.state.trades.some((trade) => trade.action === "open" && trade.reason === "manual"), true);
    const sold = await applyAgentCommand(bought.state, { code: issued.code, action: "sell", symbol: "SOL" });
    assert.equal(sold.ok, true);
    if (!sold.ok || !sold.state) return;
    assert.equal(sold.state.positions.length, 0);
    assert.equal(sold.state.trades.some((trade) => trade.action === "close" && trade.reason === "manual"), true);
    assert.equal(sold.fill?.action, "sell");
  });

  it("rejects a symbol that is not on the watchlist", async () => {
    const issued = await issueAgentGrant(book());
    assert.equal(issued.ok, true);
    if (!issued.ok) return;
    const reply = await applyAgentCommand(issued.state, {
      code: issued.code,
      action: "buy",
      symbol: "NOTACOIN",
      usd: 10,
      price: 1,
    });
    assert.equal(reply.ok, false);
    if (reply.ok) return;
    assert.match(reply.error, /watchlist/);
  });

  it("does not invent a live fill or return the trading key", async () => {
    const issued = await issueAgentGrant(book());
    assert.equal(issued.ok, true);
    if (!issued.ok) return;
    const permitted = permit(issued.state);
    const owner = permitted.bot.agentSession?.owner ?? "";
    const delegate = permitted.bot.agentSession?.delegate ?? "";
    const live: AppState = {
      ...permitted,
      config: { ...permitted.config, walletSwaps: true, executionMode: "live" },
      bot: { ...permitted.bot, running: true, swapBot: delegate },
    };
    const reply = await applyAgentCommand(live, {
      code: issued.code,
      action: "buy",
      symbol: "SOL",
      usd: 25,
      price: 100,
      account: owner,
    });
    assert.equal(reply.ok, true);
    if (!reply.ok) return;
    assert.equal(reply.fill?.action, "queued");
    assert.equal(reply.state?.positions.length, 0);
    assert.equal(reply.state?.bot.agentOrder?.symbol, "SOL");
    const body = JSON.stringify({ book: reply.book, fill: reply.fill });
    assert.equal(body.includes(delegate), false);
    assert.equal(body.includes("codeHash"), false);
    assert.equal(body.includes(issued.code), false);
    assert.equal(reply.book.account, owner);
    assert.equal(reply.book.mode, "live");
    assert.equal(reply.book.permission, "on");
    assert.equal(body.includes(live.bot.agentSession?.signature ?? "missing-signature"), false);
  });

  it("refuses a trade when the signed window is missing, expired, or edited", async () => {
    assert.equal(clampAgentMinutes(1), 5);
    assert.equal(clampAgentMinutes(10_000), 72 * 60);
    const issued = await issueAgentGrant(book());
    assert.equal(issued.ok, true);
    if (!issued.ok) return;
    const closed = await applyAgentCommand(issued.state, { code: issued.code, action: "buy", symbol: "SOL", usd: 10, price: 100 });
    assert.equal(closed.ok, false);
    if (closed.ok) return;
    assert.equal(closed.status, 403);
    const stale = permit(issued.state, 60, Date.now() - 2 * 60 * 60_000);
    const expired = await applyAgentCommand(stale, { code: issued.code, action: "sell", symbol: "SOL" });
    assert.equal(expired.ok, false);
    if (expired.ok) return;
    assert.match(expired.error, /ended/);
    const edited = permit(issued.state);
    edited.bot.agentSession = { ...edited.bot.agentSession!, expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
    const tampered = await applyAgentCommand(edited, { code: issued.code, action: "buy", symbol: "SOL", usd: 10, price: 100 });
    assert.equal(tampered.ok, false);
    if (tampered.ok) return;
    assert.match(tampered.error, /does not match/);
    const moved = permit(issued.state);
    moved.bot.agentSession = { ...moved.bot.agentSession!, delegate: Keypair.generate().publicKey.toBase58() };
    const movedReply = await applyAgentCommand(moved, { code: issued.code, action: "buy", symbol: "SOL", usd: 10, price: 100 });
    assert.equal(movedReply.ok, false);
    if (movedReply.ok) return;
    assert.match(movedReply.error, /does not match/);
    assert.equal(edited.positions.length, 0);
    const otherWallet = permit(issued.state);
    const foreign = await applyAgentCommand(otherWallet, {
      code: issued.code,
      action: "buy",
      symbol: "SOL",
      usd: 10,
      price: 100,
      account: Keypair.generate().publicKey.toBase58(),
    });
    assert.equal(foreign.ok, false);
    if (foreign.ok) return;
    assert.match(foreign.error, /different wallet/);
    const wrongKey = permit(issued.state);
    const delegate = wrongKey.bot.agentSession?.delegate ?? "";
    const mismatched: AppState = {
      ...wrongKey,
      config: { ...wrongKey.config, walletSwaps: true, executionMode: "live" },
      bot: { ...wrongKey.bot, running: true, swapBot: Keypair.generate().publicKey.toBase58() },
    };
    const keyReply = await applyAgentCommand(mismatched, {
      code: issued.code,
      action: "sell",
      symbol: "SOL",
      account: wrongKey.bot.agentSession?.owner,
    });
    assert.equal(keyReply.ok, false);
    if (keyReply.ok) return;
    assert.match(keyReply.error, /trading key/);
    const unarmed = permit(issued.state);
    unarmed.config = { ...unarmed.config, walletSwaps: true, executionMode: "live" };
    unarmed.bot = { ...unarmed.bot, running: true, swapBot: null };
    const unarmedReply = await applyAgentCommand(unarmed, {
      code: issued.code,
      action: "buy",
      symbol: "SOL",
      usd: 10,
      price: 100,
      account: unarmed.bot.agentSession?.owner,
    });
    assert.equal(unarmedReply.ok, false);
    if (unarmedReply.ok) return;
    assert.match(unarmedReply.error, /trading key/);
    assert.notEqual(delegate, mismatched.bot.swapBot);
    const armed = permit(issued.state);
    armed.config = { ...armed.config, walletSwaps: true, executionMode: "live", killSwitch: true };
    armed.bot = { ...armed.bot, running: true, swapBot: armed.bot.agentSession?.delegate ?? null };
    const killed = await applyAgentCommand(armed, {
      code: issued.code,
      action: "buy",
      symbol: "SOL",
      usd: 10,
      price: 100,
      account: armed.bot.agentSession?.owner,
    });
    assert.equal(killed.ok, false);
    if (killed.ok) return;
    assert.match(killed.error, /emergency stop/);
    const waiting = permit(issued.state);
    waiting.config = { ...waiting.config, walletSwaps: true, executionMode: "live" };
    waiting.bot = { ...waiting.bot, running: true, swapBot: waiting.bot.agentSession?.delegate ?? null };
    const first = await applyAgentCommand(waiting, {
      code: issued.code,
      action: "buy",
      symbol: "SOL",
      usd: 10,
      price: 100,
      account: waiting.bot.agentSession?.owner,
    });
    assert.equal(first.ok, true);
    if (!first.ok || !first.state) return;
    const second = await applyAgentCommand(first.state, {
      code: issued.code,
      action: "buy",
      symbol: "SOL",
      usd: 10,
      price: 100,
      account: waiting.bot.agentSession?.owner,
    });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.match(second.error, /already waiting/);
    assert.equal(first.state.bot.agentOrder?.symbol, "SOL");
  });

  it("asks the wallet to sign one transaction for the window the user picked", async () => {
    const owner = Keypair.generate();
    const delegate = Keypair.generate();
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const blockhash = Keypair.generate().publicKey.toBase58();
    let prompts = 0;
    const session = {
      address: owner.publicKey.toBase58(),
      sol: 0,
      usdc: 0,
      solPriceUsd: null,
      equityUsd: 0,
      provider: {
        connect: async () => ({ publicKey: { toBase58: () => owner.publicKey.toBase58() } }),
        signMessage: async () => {
          throw new Error("A message signature must not authorize the agent.");
        },
        signTransaction: async (tx: Transaction) => {
          prompts += 1;
          const copy = Transaction.from(
            (tx as Transaction).serialize({ requireAllSignatures: false, verifySignatures: false }),
          );
          copy.sign(owner);
          return copy;
        },
      },
    } as WalletSession;
    const lamports = 50_000_000;
    const signed = await signAgentPermission(session, expiresAt, {
      delegate: delegate.publicKey.toBase58(),
      blockhash,
      broadcast: false,
      extraInstructions: [
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: delegate.publicKey,
          lamports,
        }),
      ],
    });
    assert.equal(prompts, 1);
    assert.equal(signed.owner, owner.publicKey.toBase58());
    assert.equal(signed.delegate, delegate.publicKey.toBase58());
    assert.equal(signed.expiresAt, expiresAt);
    assert.equal(permissionSignatureMatches({ ...signed, minutes: 15 }), true);
    const message = Buffer.from(signed.message, "base64");
    assert.ok(message.includes(Buffer.from(agentPermissionMemo(signed.owner, signed.delegate, signed.expiresAt), "utf8")));
    const amount = Buffer.alloc(8);
    amount.writeBigUInt64LE(BigInt(lamports));
    assert.ok(message.includes(amount));
    assert.equal(signed.signature.includes(bs58.encode(owner.secretKey)), false);
    const restoredTx = buildAgentPermissionTransaction({
      owner: owner.publicKey,
      delegate: delegate.publicKey.toBase58(),
      expiresAt,
      blockhash,
    });
    restoredTx.sign(owner);
    const restored = agentGrantFromSignedBytes(restoredTx.serialize(), {
      owner: owner.publicKey.toBase58(),
      delegate: delegate.publicKey.toBase58(),
      expiresAt,
      minutes: 15,
      live: false,
    });
    assert.equal(restored?.owner, owner.publicKey.toBase58());
    assert.equal(restored?.minutes, 15);
    assert.equal(restored ? permissionSignatureMatches(restored) : false, true);
    assert.equal(
      agentGrantFromSignedBytes(restoredTx.serialize(), {
        owner: owner.publicKey.toBase58(),
        delegate: delegate.publicKey.toBase58(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        minutes: 15,
        live: false,
      }),
      null,
    );
    const messageOnly = {
      ...session,
      provider: {
        connect: session.provider.connect,
        signMessage: async () => ({ signature: new Uint8Array(64) }),
      },
    } as WalletSession;
    await assert.rejects(
      () => signAgentPermission(messageOnly, expiresAt, { delegate: delegate.publicKey.toBase58(), blockhash, broadcast: false }),
      /transaction/,
    );
  });
});
