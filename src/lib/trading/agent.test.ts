import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SOL_MINT } from "@/lib/market/universe";
import { emptyState } from "@/lib/store";
import type { AppState } from "@/lib/types";
import { applyAgentCommand, hashAgentCode, issueAgentGrant, mintAgentCode, normalizeAgentCode, revokeAgentGrant } from "./agent";

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
    const bought = await applyAgentCommand(issued.state, {
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
    const live: AppState = {
      ...issued.state,
      config: { ...issued.state.config, walletSwaps: true, executionMode: "live" },
      bot: { ...issued.state.bot, running: true, swapBot: "TradingKeyMustStayHidden" },
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
  });
});
