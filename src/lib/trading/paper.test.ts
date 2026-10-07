import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, emptyState } from "../store";
import type { Signal } from "../types";
import { closePosition, markBook, marksForOpen, openPosition, scaleOut, venueFeeBps } from "./paper";

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
  it("prices the Solana venue fee into practice fills", () => {
    assert.equal(venueFeeBps("mint", "SOL"), 3);
    assert.equal(venueFeeBps("mint", "SOL", 5), 7);
    assert.equal(venueFeeBps("pumpMint", "PUMP"), 20);
    assert.equal(venueFeeBps("0xabc", "CRO"), 0);
    const state = emptyState({ ...DEFAULT_CONFIG, startingEquity: 1_000 });
    const opened = openPosition(state, signal({ symbol: "PUMP", mint: "pumpMint", price: 100 }), 1);
    assert.ok(Math.abs(opened.positions[0].entryPrice - 100 * (1 + 28 / 10_000)) < 1e-9);
    const thin = openPosition(state, signal({ symbol: "PUMP", mint: "pumpMint", price: 100, targetPct: 0.5 }), 1);
    assert.ok((thin.positions[0]?.targetProfitPct ?? 0) > 0.5);
  });

  it("shrinks a ticket so a $6 book still gets a fill", () => {
    const state = emptyState({ ...DEFAULT_CONFIG, startingEquity: 6 });
    const next = openPosition(state, signal({ price: 100 }), 1);
    assert.equal(next.positions.length, 1);
    assert.ok(next.positions[0]!.notional <= 6 * 0.98);
    assert.ok(next.positions[0]!.notional >= 1);
    assert.ok(next.portfolio.cashUsd >= 0);
  });

  it("records a wallet signature on a signed fill", () => {
    const state = emptyState({ ...DEFAULT_CONFIG, startingEquity: 100 });
    const next = openPosition(state, signal({ price: 100 }), 1, "risk-on", {
      signature: "sig",
      qty: 0.4,
      price: 101,
      tokenDecimals: 6,
    });
    assert.equal(next.positions[0]?.signature, "sig");
    assert.equal(next.positions[0]?.qty, 0.4);
    assert.equal(next.positions[0]?.entryPrice, 101);
    assert.equal(next.trades[0]?.signature, "sig");
    const closed = closePosition(next, next.positions[0]!.id, 110, "target", "sig2");
    assert.equal(closed.trades[0]?.signature, "sig2");
    assert.equal(closed.trades[0]?.price, 110);
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

  it("posts margin for a 5x long and books the leveraged PnL", () => {
    const state = emptyState({ ...DEFAULT_CONFIG, startingEquity: 20 });
    const opened = openPosition(state, signal({ price: 100 }), 0.5, "risk-on", {
      signature: "sig",
      qty: 0.5,
      price: 100,
      tokenDecimals: 9,
      leverage: 5,
      collateralUsd: 10,
      positionPubkey: "pos",
    });
    const pos = opened.positions[0]!;
    assert.equal(pos.leverage, 5);
    assert.equal(pos.collateralUsd, 10);
    assert.equal(pos.positionPubkey, "pos");
    assert.ok(Math.abs(opened.portfolio.cashUsd - 10) < 1e-6);
    assert.ok(Math.abs(opened.portfolio.equityUsd - 20) < 1e-6);
    const marked = markBook(opened, new Map([[pos.mint, 102]]));
    assert.ok(Math.abs(marked.portfolio.equityUsd - 21) < 1e-6);
    const closed = closePosition(marked, pos.id, 102, "target", "sig2");
    assert.equal(closed.positions.length, 0);
    assert.ok(Math.abs(closed.portfolio.cashUsd - 21) < 1e-6);
  });

  it("posts margin for a 5x and a 10x short and returns only that slice on a scale-out", () => {
    const state = emptyState({ ...DEFAULT_CONFIG, startingEquity: 20 });
    const five = openPosition(state, signal({ side: "short", price: 100 }), 0.5, "risk-on", {
      signature: "sig",
      qty: 0.5,
      price: 100,
      tokenDecimals: 9,
      leverage: 5,
      collateralUsd: 10,
      positionPubkey: "pos",
    });
    const pos = five.positions[0]!;
    assert.equal(pos.side, "short");
    assert.equal(pos.leverage, 5);
    assert.equal(pos.stopPrice, 102);
    assert.equal(pos.targetPrice, 96);
    const won = markBook(five, new Map([[pos.mint, 90]]));
    assert.ok(Math.abs(won.portfolio.equityUsd - 25) < 1e-6);
    const scaled = scaleOut(won, pos.id, 0.5, "sig-scale", 90);
    assert.ok(Math.abs(scaled.portfolio.cashUsd - 17.5) < 1e-6);
    assert.equal(scaled.positions[0]?.qty, 0.25);
    assert.ok(Math.abs((scaled.positions[0]?.collateralUsd ?? 0) - 5) < 1e-6);
    assert.ok(Math.abs(scaled.portfolio.equityUsd - 25) < 1e-6);

    const ten = openPosition(state, signal({ side: "short", price: 100 }), 1, "risk-on", {
      signature: "sig10",
      qty: 1,
      price: 100,
      tokenDecimals: 9,
      leverage: 10,
      collateralUsd: 10,
      positionPubkey: "pos10",
    });
    const short = ten.positions[0]!;
    const lost = markBook(ten, new Map([[short.mint, 101]]));
    assert.ok(Math.abs(lost.portfolio.equityUsd - 19) < 1e-6);
    const flat = closePosition(lost, short.id, 110, "stop", "sig-stop");
    assert.equal(flat.positions.length, 0);
    assert.ok(Math.abs(flat.portfolio.cashUsd - 10) < 1e-6);
    assert.ok((flat.trades[0]?.pnlUsd ?? 0) < 0);
  });

  it("posts margin for a 10x long and books the leveraged gain", () => {
    const state = emptyState({ ...DEFAULT_CONFIG, startingEquity: 20 });
    const opened = openPosition(state, signal({ price: 100 }), 1, "risk-on", {
      signature: "sig",
      qty: 1,
      price: 100,
      tokenDecimals: 9,
      leverage: 10,
      collateralUsd: 10,
      positionPubkey: "pos",
    });
    const pos = opened.positions[0]!;
    assert.equal(pos.leverage, 10);
    const marked = markBook(opened, new Map([[pos.mint, 101]]));
    assert.ok(Math.abs(marked.portfolio.equityUsd - 21) < 1e-6);
    const closed = closePosition(marked, pos.id, 101, "target", "sig2");
    assert.ok(Math.abs(closed.portfolio.cashUsd - 21) < 1e-6);
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

  it("moves a mark onto a checksum quote and keeps it when the quote is zero", () => {
    const state = emptyState({ ...DEFAULT_CONFIG, startingEquity: 1_000 });
    const opened = openPosition(
      state,
      signal({ mint: "0xAbCdEF0000000000000000000000000000000001", price: 100 }),
      1,
    );
    const pos = opened.positions[0]!;
    const moved = markBook(
      opened,
      marksForOpen([pos], [{ mint: "0xabcdef0000000000000000000000000000000001", price: 80 }]),
    );
    assert.equal(moved.positions[0]?.markPrice, 80);
    const stuck = markBook(opened, marksForOpen([pos], [{ mint: pos.mint, price: 0 }]));
    assert.equal(stuck.positions[0]?.markPrice, pos.entryPrice);
  });

  it("closes one ticket without flattening the rest of the book", () => {
    let state = emptyState({ ...DEFAULT_CONFIG, startingEquity: 1_000 });
    state = openPosition(state, signal({ mint: "mint-keep", symbol: "KEEP", price: 100 }), 1);
    state = openPosition(state, signal({ mint: "mint-drop", symbol: "DROP", price: 40 }), 1);
    assert.equal(state.positions.length, 2);
    const drop = state.positions.find((p) => p.mint === "mint-drop")!;
    const keep = state.positions.find((p) => p.mint === "mint-keep")!;
    const closed = closePosition(state, drop.id, drop.markPrice, "manual");
    assert.equal(closed.positions.length, 1);
    assert.equal(closed.positions[0]!.id, keep.id);
    assert.equal(closed.positions[0]!.mint, "mint-keep");
  });

  it("marks a ticket that left the book from its pool print", () => {
    const state = emptyState({ ...DEFAULT_CONFIG, startingEquity: 1_000 });
    const opened = openPosition(state, signal({ mint: "left-the-book", poolAddress: "pool-a", price: 100 }), 1);
    const pos = opened.positions[0]!;
    const marked = markBook(opened, marksForOpen([pos], [], [{ pool: "pool-a", price: 140 }]));
    assert.equal(marked.positions[0]?.markPrice, 140);
  });
});
