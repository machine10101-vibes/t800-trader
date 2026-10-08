import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../store";
import type { Signal, Trade } from "../types";
import { applyControl } from "../trading/bot";
import { closePosition, openPosition } from "../trading/paper";
import { SOL_PROFIT_SHARE_ADDRESS } from "../solana/share";
import {
  applyCronosProfitShares,
  CRO_PROFIT_SHARE_ADDRESS,
  CRO_PROFIT_SHARE_PCT,
  cronosProfitShares,
  profitShareUsd,
  takeCronosProfitShare,
} from "./share";

function trade(over: Partial<Trade> = {}): Trade {
  return {
    id: "t",
    mint: "0xabc",
    symbol: "VVS",
    side: "long",
    action: "close",
    qty: 10,
    price: 1.5,
    pnlUsd: 10,
    pnlPct: 4,
    reason: "target",
    at: "2026-10-08T00:00:00.000Z",
    note: "target exit from reclaim entry",
    cronosQuote: "usdc",
    ...over,
  };
}

function signal(over: Partial<Signal> = {}): Signal {
  return {
    id: "s",
    mint: "0xabc",
    symbol: "VVS",
    poolAddress: "0xpool",
    sector: "DEX",
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

function bookWith(trades: Trade[], cashUsd = 200, cronosQuote: "usdc" | "cro" = "usdc") {
  const state = emptyState({ startingEquity: cashUsd, cronosQuote });
  return { ...state, trades, portfolio: { ...state.portfolio, cashUsd } };
}

describe("cronos profit share", () => {
  it("sends 10% of a gain to the Cronos profit address", () => {
    assert.equal(CRO_PROFIT_SHARE_PCT, 10);
    assert.equal(CRO_PROFIT_SHARE_ADDRESS, "4hjme16Q6nxJXqKynFn5fbM4xswwjXE4v5HcCv64dDkv");
    assert.equal(CRO_PROFIT_SHARE_ADDRESS, SOL_PROFIT_SHARE_ADDRESS);
    assert.equal(profitShareUsd(100), 10);
    assert.equal(profitShareUsd(2.5), 0.25);
    assert.equal(profitShareUsd(0), 0);
    assert.equal(profitShareUsd(-8), 0);
    assert.equal(profitShareUsd(0.04), 0);
  });

  it("keeps the coin the ticket spent, even after Settings change", () => {
    const state = bookWith(
      [
        trade({ id: "usdc", pnlUsd: 20, symbol: "VVS", cronosQuote: "usdc" }),
        trade({ id: "cro", pnlUsd: 30, symbol: "ULTI", cronosQuote: "cro" }),
        trade({ id: "loss", pnlUsd: -5, cronosQuote: "usdc" }),
        trade({ id: "paid", pnlUsd: 12, note: "target exit. Shared $1.20 (10%) to the profit address in USDC." }),
      ],
      200,
      "cro",
    );
    const due = cronosProfitShares(state);
    assert.deepEqual(due, [
      { tradeId: "usdc", symbol: "VVS", shareUsd: 2, quote: "usdc" },
      { tradeId: "cro", symbol: "ULTI", shareUsd: 3, quote: "cro" },
    ]);
  });

  it("cuts paper cash once and names USDC or CRO on the close", () => {
    const state = bookWith([
      trade({ id: "usdc", pnlUsd: 20, cronosQuote: "usdc" }),
      trade({ id: "cro", pnlUsd: 10, cronosQuote: "cro" }),
    ], 200);
    const once = applyCronosProfitShares(state, [
      { tradeId: "usdc", shareUsd: 2, quote: "usdc", signature: "0xusdc" },
      { tradeId: "cro", shareUsd: 1, quote: "cro" },
    ]);
    assert.equal(once.portfolio.cashUsd, 197);
    assert.match(once.trades.find((row) => row.id === "usdc")!.note, /Shared \$2\.00 \(10%\) to the profit address in USDC · 0xusdc/);
    assert.match(once.trades.find((row) => row.id === "cro")!.note, /Shared \$1\.00 \(10%\) to the profit address in CRO/);
    const twice = applyCronosProfitShares(once, [
      { tradeId: "usdc", shareUsd: 2, quote: "usdc" },
      { tradeId: "cro", shareUsd: 1, quote: "cro" },
    ]);
    assert.equal(twice.portfolio.cashUsd, 197);
    assert.equal(cronosProfitShares(once).length, 0);
  });

  it("takes paper shares when live send is not armed", async () => {
    const state = bookWith([trade({ id: "win", pnlUsd: 30, symbol: "VVS", cronosQuote: "usdc" })], 100);
    const next = await takeCronosProfitShare(state, { live: true, owner: null });
    assert.equal(next.portfolio.cashUsd, 97);
    assert.match(next.trades[0]!.note, /Shared \$3\.00 \(10%\) to the profit address in USDC/);
    assert.equal(cronosProfitShares(next).length, 0);
  });

  it("stamps the ticket quote on a close and shares it on flatten", () => {
    let usdc = emptyState({ startingEquity: 1_000, cronosQuote: "usdc" });
    usdc = openPosition(usdc, signal({ mint: "0xa", symbol: "VVS", price: 100 }), 1);
    assert.equal(usdc.positions[0]?.cronosQuote, "usdc");
    const closed = closePosition(usdc, usdc.positions[0]!.id, usdc.positions[0]!.entryPrice * 1.5, "target");
    assert.equal(closed.trades[0]?.cronosQuote, "usdc");

    let cro = emptyState({ startingEquity: 1_000, cronosQuote: "cro" });
    cro = openPosition(cro, signal({ mint: "0xb", symbol: "ULTI", price: 50 }), 1);
    cro = {
      ...cro,
      positions: cro.positions.map((pos) => ({ ...pos, markPrice: pos.entryPrice * 1.5 })),
    };
    const flat = applyControl(cro, "flatten", "cronos");
    const win = flat.trades.find((row) => row.action === "close" && (row.pnlUsd ?? 0) > 0);
    assert.equal(win?.cronosQuote, "cro");
    assert.match(win!.note, /Shared \$/);
    assert.match(win!.note, /in CRO/);
  });
});
