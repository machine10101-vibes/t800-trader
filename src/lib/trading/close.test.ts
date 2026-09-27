import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, emptyState } from "../store";
import type { Signal } from "../types";
import { applyHandClose, bracketFillBlocksEntry, bracketQuiet, isAlreadyFlat, reentryBlocked, reentryHold, reentryNote } from "./close";
import { openPosition } from "./paper";

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

describe("hand close", () => {
  it("blocks the same mint until the hold expires", () => {
    const now = Date.parse("2026-09-25T00:00:00.000Z");
    const hold = reentryHold("mint-sol", now);
    assert.equal(reentryBlocked(hold, "mint-sol", now + 1_000), true);
    assert.equal(reentryBlocked(hold, "mint-zbcn", now + 1_000), false);
    assert.equal(reentryBlocked(hold, "mint-sol", now + 3 * 60_000), false);
    assert.equal(reentryBlocked(null, "mint-sol", now), false);
    const target = reentryHold("mint-sol", now, "target");
    assert.equal(target.why, "target");
    assert.equal(reentryNote("SOL", "target"), "SOL: target was preset — no new trade");
    assert.equal(reentryNote("SOL", "stop"), "SOL: stop was preset — no new trade");
    assert.equal(bracketFillBlocksEntry("target"), true);
    assert.equal(bracketFillBlocksEntry("stop"), true);
    assert.equal(bracketFillBlocksEntry("fade"), false);
    assert.equal(bracketQuiet(target.until, now + 1_000), true);
    assert.equal(bracketQuiet(target.until, now + 3 * 60_000), false);
  });

  it("only treats an explicit already-flat close as a book cleanup", () => {
    assert.equal(isAlreadyFlat("ALREADY_FLAT: trading key does not hold this token"), true);
    assert.equal(isAlreadyFlat("Jupiter could not simulate this swap"), false);
  });

  it("closes only the named ticket and leaves the rest of the book", () => {
    let state = emptyState({ ...DEFAULT_CONFIG, startingEquity: 1_000 });
    state = openPosition(state, signal({ mint: "mint-a", symbol: "AAA", price: 100 }), 1);
    state = openPosition(state, signal({ mint: "mint-b", symbol: "BBB", price: 50 }), 1);
    state = openPosition(state, signal({ mint: "mint-c", symbol: "CCC", price: 25 }), 1);
    assert.equal(state.positions.length, 3);
    const drop = state.positions.find((p) => p.mint === "mint-b")!;
    const closed = applyHandClose(state, drop.id, drop.markPrice);
    assert.equal(closed.positions.length, 2);
    assert.deepEqual(
      closed.positions.map((p) => p.mint).sort(),
      ["mint-a", "mint-c"],
    );
    assert.equal(closed.bot.skipReentry?.mint, "mint-b");
    assert.equal(closed.bot.lastNote, "Closed BBB by hand");
    assert.equal(closed.trades[0]?.reason, "manual");
    assert.equal(closed.trades[0]?.mint, "mint-b");
  });
});
