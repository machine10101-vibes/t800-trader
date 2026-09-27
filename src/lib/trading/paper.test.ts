import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../store";
import type { Signal } from "../types";
import { closePosition, fillPrice, markBook, openPosition, pushEquity } from "./paper";

function signal(over: Partial<Signal> = {}): Signal {
  return {
    id: "s",
    mint: "mint1",
    symbol: "ABC",
    poolAddress: "pool",
    side: "long",
    reason: "breakout",
    confidence: 70,
    price: 100,
    stopPct: 2,
    targetPct: 4,
    thesis: "test",
    researchScore: 60,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function book(equity = 10_000) {
  return emptyState({
    startingEquity: equity,
    maxPositions: 4,
    maxRiskPerTradePct: 1.1,
    dailyLossLimitPct: 6,
    minLiquidityUsd: 120_000,
    minVolume24hUsd: 80_000,
    minAgeHours: 8,
    allowShorts: true,
    allowMemes: true,
    scanSeconds: 8,
  });
}

describe("paper book", () => {
  it("slips longs up on open and down on close", () => {
    assert.ok(fillPrice(100, "long", "open") > 100);
    assert.ok(fillPrice(100, "long", "close") < 100);
    assert.ok(fillPrice(100, "short", "open") < 100);
    assert.ok(fillPrice(100, "short", "close") > 100);
  });

  it("opens and closes a long so cash reflects the fill PnL", () => {
    const opened = openPosition(book(), signal({ side: "long", price: 100 }), 10);
    assert.equal(opened.positions.length, 1);
    assert.ok(opened.portfolio.cashUsd < 10_000);
    const pos = opened.positions[0];
    const closed = closePosition(opened, pos.id, 110, "target");
    assert.equal(closed.positions.length, 0);
    assert.ok(closed.portfolio.realizedPnlUsd > 0);
    assert.ok(closed.portfolio.cashUsd > 10_000);
    assert.equal(closed.portfolio.winCount, 1);
  });

  it("marks a winning short higher, not lower, when price falls", () => {
    const opened = openPosition(book(), signal({ side: "short", price: 100 }), 10);
    const pos = opened.positions[0];
    const marked = markBook(opened, new Map([[pos.mint, 90]]));
    assert.ok(marked.portfolio.unrealizedPnlUsd > 0);
    assert.ok(marked.portfolio.equityUsd > 10_000);
    const closed = closePosition(marked, pos.id, 90, "target");
    assert.equal(closed.positions.length, 0);
    assert.ok(closed.portfolio.realizedPnlUsd > 0);
    assert.ok(closed.portfolio.cashUsd > 10_000);
  });

  it("refuses an open that exceeds cash and leaves the book unchanged", () => {
    const state = book(50);
    const next = openPosition(state, signal({ price: 100 }), 10);
    assert.equal(next.positions.length, 0);
    assert.equal(next.portfolio.cashUsd, 50);
  });

  it("caps the equity curve at 360 points", () => {
    let state = book();
    for (let i = 0; i < 370; i++) state = pushEquity(state);
    assert.equal(state.equityCurve.length, 360);
  });
});
