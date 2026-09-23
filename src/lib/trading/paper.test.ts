import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, emptyState } from "../store";
import type { Signal } from "../types";
import { closePosition, markBook, openPosition, scaleOut } from "./paper";

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

describe("paper", () => {
  it("shrinks a ticket so a $6 book still gets a fill", () => {
    const state = emptyState({ ...DEFAULT_CONFIG, startingEquity: 6 });
    const next = openPosition(state, signal({ price: 100 }), 1);
    assert.equal(next.positions.length, 1);
    assert.ok(next.positions[0]!.notional <= 6 * 0.98);
    assert.ok(next.positions[0]!.notional >= 1);
    assert.ok(next.portfolio.cashUsd >= 0);
  });

  it("marks a short winner as profit and returns it to cash", () => {
    const state = emptyState({ ...DEFAULT_CONFIG, startingEquity: 1_000 });
    const opened = openPosition(state, signal({ side: "short", price: 100 }), 1);
    const pos = opened.positions[0]!;
    const marked = markBook(opened, new Map([[pos.mint, pos.entryPrice * 0.9]]));
    assert.ok(marked.portfolio.equityUsd > 1_000);
    const closed = closePosition(marked, pos.id, pos.entryPrice * 0.9, "target");
    assert.equal(closed.positions.length, 0);
    assert.ok(closed.portfolio.cashUsd > 1_000);
    assert.ok((closed.trades[0]?.pnlUsd ?? 0) > 0);
    assert.ok(Math.abs(closed.portfolio.equityUsd - closed.portfolio.cashUsd) < 1e-6);
  });

  it("refreshes equity on a manual close and counts a scale-out", () => {
    const state = emptyState({ ...DEFAULT_CONFIG, startingEquity: 1_000 });
    const opened = openPosition(state, signal({ price: 100 }), 1);
    assert.ok(Math.abs(opened.portfolio.equityUsd - (opened.portfolio.cashUsd + opened.positions[0]!.qty * opened.positions[0]!.markPrice)) < 1e-6);
    const pos = opened.positions[0]!;
    const marked = markBook(opened, new Map([[pos.mint, pos.entryPrice * 1.05]]));
    const scaled = scaleOut(marked, pos.id, 0.5);
    assert.equal(scaled.portfolio.winCount, 1);
    assert.equal(scaled.positions.length, 1);
    const rest = scaled.positions[0]!;
    const mtm = scaled.portfolio.cashUsd + rest.qty * rest.markPrice;
    assert.ok(Math.abs(scaled.portfolio.equityUsd - mtm) < 1e-6);
    const closed = closePosition(scaled, rest.id, rest.markPrice, "manual");
    assert.equal(closed.positions.length, 0);
    assert.ok(Math.abs(closed.portfolio.equityUsd - closed.portfolio.cashUsd) < 1e-6);
    assert.equal(closed.portfolio.winCount, 2);
  });
});
