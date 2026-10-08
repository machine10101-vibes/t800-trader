import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../store";
import type { Signal, Trade } from "../types";
import { applyControl } from "../trading/bot";
import { openPosition } from "../trading/paper";
import {
  applySolProfitShares,
  profitShareUsd,
  SOL_PROFIT_SHARE_ADDRESS,
  SOL_PROFIT_SHARE_PCT,
  solProfitShares,
  takeSolProfitShare,
} from "./share";

function trade(over: Partial<Trade> = {}): Trade {
  return {
    id: "t",
    mint: "mint",
    symbol: "JUP",
    side: "long",
    action: "close",
    qty: 10,
    price: 1.5,
    pnlUsd: 10,
    pnlPct: 4,
    reason: "target",
    at: "2026-10-08T00:00:00.000Z",
    note: "target exit from reclaim entry",
    ...over,
  };
}

function signal(over: Partial<Signal> = {}): Signal {
  return {
    id: "s",
    mint: "mint",
    symbol: "SOL",
    poolAddress: "pool",
    sector: "L1",
    side: "long",
    reason: "reclaim",
    confidence: 70,
    price: 100,
    stopPct: 2,
    targetPct: 4,
    thesis: "t",
    researchScore: 65,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function bookWith(trades: Trade[], cashUsd = 200) {
  const state = emptyState({ startingEquity: cashUsd });
  return { ...state, trades, portfolio: { ...state.portfolio, cashUsd } };
}

describe("sol profit share", () => {
  it("sends 10% of a gain and nothing on a scratch or loss", () => {
    assert.equal(SOL_PROFIT_SHARE_PCT, 10);
    assert.equal(SOL_PROFIT_SHARE_ADDRESS, "4hjme16Q6nxJXqKynFn5fbM4xswwjXE4v5HcCv64dDkv");
    assert.equal(profitShareUsd(100), 10);
    assert.equal(profitShareUsd(2.5), 0.25);
    assert.equal(profitShareUsd(0), 0);
    assert.equal(profitShareUsd(-8), 0);
    assert.equal(profitShareUsd(0.04), 0);
  });

  it("lists unmarked winning closes and skips opens, losses, and already shared rows", () => {
    const state = bookWith([
      trade({ id: "win", pnlUsd: 20, symbol: "JUP" }),
      trade({ id: "dust", pnlUsd: 0.04 }),
      trade({ id: "loss", pnlUsd: -5 }),
      trade({ id: "open", action: "open", pnlUsd: null }),
      trade({ id: "paid", pnlUsd: 12, note: "target exit. Shared $1.20 (10%) to the profit address." }),
    ]);
    const due = solProfitShares(state);
    assert.deepEqual(due, [{ tradeId: "win", symbol: "JUP", shareUsd: 2 }]);
  });

  it("cuts paper cash once and stamps the close note", () => {
    const state = bookWith([trade({ id: "win", pnlUsd: 20 })], 200);
    const once = applySolProfitShares(state, [{ tradeId: "win", shareUsd: 2, signature: "sig" }]);
    assert.equal(once.portfolio.cashUsd, 198);
    assert.match(once.trades[0]!.note, /Shared \$2\.00 \(10%\) to the profit address · sig/);
    const twice = applySolProfitShares(once, [{ tradeId: "win", shareUsd: 2 }]);
    assert.equal(twice.portfolio.cashUsd, 198);
    assert.equal(solProfitShares(once).length, 0);
  });

  it("takes paper shares when live send is not armed", async () => {
    const state = bookWith([trade({ id: "win", pnlUsd: 30, symbol: "WIF" })], 100);
    const next = await takeSolProfitShare(state, { live: true, owner: null });
    assert.equal(next.portfolio.cashUsd, 97);
    assert.match(next.trades[0]!.note, /Shared \$3\.00/);
    assert.equal(solProfitShares(next).length, 0);
  });

  it("shares every Solana flatten winner and leaves Cronos cash alone", () => {
    let state = emptyState({ startingEquity: 1_000 });
    state = openPosition(state, signal({ mint: "mint-a", symbol: "AAA", price: 100 }), 1);
    state = openPosition(state, signal({ mint: "mint-b", symbol: "BBB", price: 50 }), 1);
    state = {
      ...state,
      positions: state.positions.map((pos) => ({ ...pos, markPrice: pos.entryPrice * 1.5 })),
    };
    const sol = applyControl(state, "flatten", "solana");
    const cro = applyControl(state, "flatten", "cronos");
    const solWins = sol.trades.filter((row) => row.action === "close" && (row.pnlUsd ?? 0) > 0);
    const croWins = cro.trades.filter((row) => row.action === "close" && (row.pnlUsd ?? 0) > 0);
    assert.equal(solWins.length, 2);
    assert.equal(croWins.length, 2);
    assert.ok(solWins.every((row) => row.note.includes("Shared $")));
    assert.ok(croWins.every((row) => !row.note.includes("Shared $")));
    assert.ok(sol.portfolio.cashUsd < cro.portfolio.cashUsd);
    assert.ok(sol.portfolio.cashUsd > 0);
  });
});
