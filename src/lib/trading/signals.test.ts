import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { atrTradeable, ema, rewardToRisk, rsi, snapshotTechnical } from "./signals";
import type { Candle } from "../types";

function candles(n: number, start = 100): Candle[] {
  const out: Candle[] = [];
  let px = start;
  for (let i = 0; i < n; i++) {
    px += i % 6 === 0 ? -0.4 : 0.35;
    out.push({
      time: 1_700_000_000 + i * 300,
      open: px - 0.1,
      high: px + 0.2,
      low: px - 0.2,
      close: px,
      volume: 1000 + i * 10,
    });
  }
  return out;
}

describe("indicators", () => {
  it("computes a bounded RSI", () => {
    const values = candles(40).map((c) => c.close);
    const value = rsi(values, 14);
    assert.ok(value !== null);
    assert.ok(value >= 0 && value <= 100);
  });

  it("needs enough points for EMA", () => {
    assert.equal(ema([1, 2], 9), null);
    assert.ok(ema(candles(30).map((c) => c.close), 9) !== null);
  });

  it("builds a technical snapshot", () => {
    const snap = snapshotTechnical(candles(40));
    assert.ok(snap.lastClose);
    assert.ok(snap.rsi14 !== null);
    assert.ok(snap.priorHigh !== null);
    assert.ok(snap.closeStrength !== null);
  });

  it("rejects untradeable ATR", () => {
    assert.equal(atrTradeable(0.2), false);
    assert.equal(atrTradeable(8), false);
    assert.equal(atrTradeable(1.4), true);
  });

  it("requires at least 1.6R", () => {
    assert.ok(rewardToRisk(1, 1.7) >= 1.6);
    assert.ok(rewardToRisk(2, 2) < 1.6);
  });
});
