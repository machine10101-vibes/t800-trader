import { describe, it } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { SOL_MINT } from "@/lib/market/universe";
import { emptyState } from "@/lib/store";
import type { AppState } from "@/lib/types";
import { applyAgentCommand, hashAgentCode, issueAgentGrant, mintAgentCode, normalizeAgentCode, revokeAgentGrant } from "./agent";
import { agentPermissionMessage, clampAgentMinutes, permissionSignatureMatches } from "./agentPermission";
import { signAgentPermission } from "@/lib/solana/agentSign";
import type { WalletSession } from "@/lib/solana/wallet";

function permit(state: AppState, minutes = 60, now = Date.now()): AppState {
  const pair = nacl.sign.keyPair();
  const owner = bs58.encode(pair.publicKey);
  const expiresAt = new Date(now + minutes * 60_000).toISOString();
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(agentPermissionMessage(owner, expiresAt)), pair.secretKey));
  return {
    ...state,
    bot: {
      ...state.bot,
      agentSession: { owner, signedAt: new Date(now).toISOString(), expiresAt, minutes, signature },
    },
  };
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
    const live: AppState = {
      ...permitted,
      config: { ...permitted.config, walletSwaps: true, executionMode: "live" },
      bot: { ...permitted.bot, running: true, swapBot: "TradingKeyMustStayHidden" },
    };
    const reply = await applyAgentCommand(live, {
      code: issued.code,
      action: "buy",
      symbol: "SOL",
      usd: 25,
      price: 100,
      account: "OwnerWalletPublic",
    });
    assert.equal(reply.ok, true);
    if (!reply.ok) return;
    assert.equal(reply.fill?.action, "queued");
    assert.equal(reply.state?.positions.length, 0);
    assert.equal(reply.state?.bot.agentOrder?.symbol, "SOL");
    const body = JSON.stringify({ book: reply.book, fill: reply.fill });
    assert.equal(body.includes("TradingKeyMustStayHidden"), false);
    assert.equal(body.includes("codeHash"), false);
    assert.equal(body.includes(issued.code), false);
    assert.equal(reply.book.account, "OwnerWalletPublic");
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
    assert.equal(edited.positions.length, 0);
  });

  it("keeps one wallet signature for the window the user picked", async () => {
    const pair = nacl.sign.keyPair();
    const owner = bs58.encode(pair.publicKey);
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const session = {
      address: owner,
      sol: 0,
      usdc: 0,
      solPriceUsd: null,
      equityUsd: 0,
      provider: {
        connect: async () => ({ publicKey: { toBase58: () => owner } }),
        signMessage: async (message: Uint8Array) => ({ signature: nacl.sign.detached(message, pair.secretKey) }),
      },
    } as WalletSession;
    const signed = await signAgentPermission(session, expiresAt);
    assert.equal(signed.owner, owner);
    assert.equal(signed.expiresAt, expiresAt);
    assert.equal(permissionSignatureMatches({ ...signed, minutes: 15 }), true);
    assert.equal(signed.signature.includes(bs58.encode(pair.secretKey)), false);
  });
});
