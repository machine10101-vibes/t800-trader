import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, emptyState } from "../store";
import type { Position, Signal } from "../types";
import { advise, ensureMemory, learningReport, rememberClose, studyTape } from "./learn";
import { closePosition, openPosition } from "./paper";

function position(over: Partial<Position> = {}): Position {
  return {
    id: "p",
    mint: "m",
    symbol: "BONK",
    poolAddress: "pool",
    sector: "Meme",
    side: "long",
    qty: 1,
    entryPrice: 100,
    markPrice: 98,
    stopPrice: 98,
    targetPrice: 104,
    openedAt: new Date().toISOString(),
    lastUpdate: new Date().toISOString(),
    reason: "reclaim",
    researchScore: 60,
    highWater: 100,
    lowWater: 98,
    notional: 100,
    initialStop: 98,
    scaled: false,
    ...over,
  };
}

function signal(over: Partial<Signal> = {}): Signal {
  return {
    id: "s",
    mint: "m",
    symbol: "BONK",
    poolAddress: "pool",
    sector: "Meme",
    side: "long",
    reason: "reclaim",
    confidence: 70,
    price: 1,
    stopPct: 2,
    targetPct: 4,
    thesis: "t",
    researchScore: 65,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function lose(state = emptyState(), symbol = "BONK") {
  return rememberClose(state, { position: position({ symbol, id: symbol }), pnlUsd: -1, r: -0.4, exitReason: "stop" });
}

describe("learn", () => {
  it("leaves a new book unchanged until the journal has evidence", () => {
    const advice = advise(signal(), ensureMemory(undefined), "defensive");
    assert.equal(advice.block, null);
    assert.equal(advice.confidenceDelta, 0);
    assert.equal(advice.sizeMul, 1);
    assert.match(learningReport(undefined).summary, /No graded/);
  });

  it("fades a setup only after repeated losses and favors one that pays", () => {
    let book = emptyState();
    book = lose(book);
    assert.equal(advise(signal(), book.memory, "defensive").block, null);

    book = lose(lose(lose(book)));
    const faded = advise(signal(), book.memory, "defensive");
    assert.match(faded.block ?? "", /losing book/);

    let paid = emptyState();
    for (let i = 0; i < 4; i += 1) {
      paid = rememberClose(paid, { position: position({ id: `w${i}` }), pnlUsd: 1, r: 0.5, exitReason: "target" });
    }
    const favor = advise(signal(), paid.memory, "risk-on");
    assert.equal(favor.block, null);
    assert.ok(favor.confidenceDelta >= 4);
    assert.ok(favor.sizeMul > 1);
  });

  it("stops a name after three straight losing closes", () => {
    let book = emptyState();
    book = lose(book, "JUP");
    book = rememberClose(book, {
      position: position({ symbol: "JUP", reason: "breakout", id: "b" }),
      pnlUsd: -1,
      r: -0.3,
      exitReason: "stop",
    });
    book = rememberClose(book, {
      position: position({ symbol: "JUP", reason: "fade", sector: "DEX", id: "c" }),
      pnlUsd: -1,
      r: -0.2,
      exitReason: "time",
    });
    assert.match(advise(signal({ symbol: "JUP", sector: "DEX", reason: "fade" }), book.memory, "mixed").block ?? "", /last 3 closes/);
  });

  it("grades a tape read after the window and lets misses tighten the next ticket", () => {
    const row = (price: number) => [{ mint: "sol", symbol: "SOL", sector: "L1" as const, priceUsd: price, researchScore: 70 }];
    const t0 = Date.parse("2026-09-24T00:00:00Z");
    let state = studyTape(emptyState(), row(100), "mixed", t0);
    assert.equal(state.memory.lessons.length, 0);
    assert.ok(state.memory.pendingReads.some((read) => read.symbol === "SOL"));

    state = studyTape(state, row(100.05), "mixed", t0 + 60_000);
    assert.equal(state.memory.lessons.length, 0);
    assert.equal(state.memory.pendingReads.filter((read) => read.symbol === "SOL").length, 1);

    let price = 100;
    for (let i = 0; i < 5; i += 1) {
      price -= 1;
      state = studyTape(state, row(price), "mixed", t0 + (i + 1) * 11 * 60_000);
    }
    const reads = state.memory.lessons.filter((lesson) => lesson.key === "read:L1");
    assert.equal(reads.length, 5);
    assert.ok(reads.every((lesson) => !lesson.hit));
    const advice = advise(signal({ symbol: "SOL", sector: "L1", reason: "reclaim" }), state.memory, "mixed");
    assert.ok(advice.confidenceDelta < 0);
    assert.ok(advice.sizeMul < 1);
    assert.match(learningReport(state.memory).summary, /tape read/);
  });

  it("records a lesson on a full close", () => {
    const opened = openPosition(emptyState({ ...DEFAULT_CONFIG, startingEquity: 1_000 }), signal({ price: 100, sector: "L1", symbol: "SOL" }), 1, "risk-on");
    const pos = opened.positions[0]!;
    const closed = closePosition(opened, pos.id, pos.entryPrice * 1.04, "target");
    assert.equal(closed.memory.lessons.length, 1);
    assert.equal(closed.memory.lessons[0]?.hit, true);
    assert.equal(closed.memory.lessons[0]?.key, "trade:long:reclaim:L1");
  });
});
