import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeChart, clusterLevels, findPivots, frameBias } from "./analysis";
import { derivedFrames, rollUp, sourceFrame } from "./frames";
import type { Candle } from "../types";

function zigzag(legs: number[], barsPerLeg = 6): Candle[] {
  const out: Candle[] = [];
  let px = legs[0];
  for (let l = 1; l < legs.length; l++) {
    const step = (legs[l] - legs[l - 1]) / barsPerLeg;
    for (let b = 0; b < barsPerLeg; b++) {
      const open = px;
      px += step;
      out.push({ time: out.length * 14_400, open, high: Math.max(open, px) + 0.1, low: Math.min(open, px) - 0.1, close: px, volume: 1000 });
    }
  }
  return out;
}

describe("chart analysis", () => {
  it("labels swing points as higher highs and higher lows in a rising zigzag", () => {
    const rows = zigzag([100, 110, 105, 116, 111, 122, 117, 128, 123, 134, 129, 140]);
    const labels = findPivots(rows).map((p) => p.label).filter(Boolean);
    assert.ok(labels.includes("HH"));
    assert.ok(labels.includes("HL"));
    assert.ok(!labels.includes("LL"));
    const read = analyzeChart(rows);
    assert.equal(read.structure, "higher highs and higher lows");
    assert.equal(read.bias, "up");
    assert.equal(frameBias(rows), "up");
    assert.ok(read.trendlines.some((line) => line.kind === "support" && line.rising));
  });

  it("calls a falling zigzag a downtrend", () => {
    const read = analyzeChart(zigzag([140, 130, 135, 124, 129, 118, 123, 112, 117, 106, 111, 100]));
    assert.equal(read.structure, "lower highs and lower lows");
    assert.equal(read.bias, "down");
    assert.ok(read.fib && read.fib.direction === "down");
  });

  it("merges touches of the same price into one level", () => {
    const pivots = [
      { index: 1, price: 100, kind: "low" as const, label: null },
      { index: 5, price: 100.3, kind: "low" as const, label: null },
      { index: 9, price: 110, kind: "high" as const, label: null },
    ];
    const { supports, resistances } = clusterLevels(pivots, 105, 0.5);
    assert.equal(supports[0].touches, 2);
    assert.ok(Math.abs(supports[0].price - 100.15) < 1e-9);
    assert.equal(resistances[0].price, 110);
  });

  it("has no opinion on too few bars", () => {
    assert.equal(frameBias(zigzag([100, 101], 4)), null);
  });
});

describe("frame roll-up", () => {
  it("builds 15-minute bars from 5-minute bars on UTC boundaries", () => {
    const five: Candle[] = [0, 300, 600, 900].map((t, i) => ({ time: t, open: 10 + i, high: 12 + i, low: 9 + i, close: 11 + i, volume: 5 }));
    const fifteen = rollUp(five, 900);
    assert.equal(fifteen.length, 2);
    assert.deepEqual(fifteen[0], { time: 0, open: 10, high: 14, low: 9, close: 13, volume: 15 });
    assert.equal(fifteen[1].time, 900);
  });

  it("fills the 1-hour and 4-hour from one 15-minute series so Cronos only needs one read", () => {
    const fifteen: Candle[] = Array.from({ length: 1000 }, (_, i) => ({
      time: i * 900,
      open: 1,
      high: 1.1,
      low: 0.9,
      close: 1,
      volume: 2,
    }));
    const filled = derivedFrames(fifteen, "15m");
    assert.equal(filled["15m"]?.length, 1000);
    assert.equal(filled["1h"]?.length, 250);
    assert.equal(filled["4h"]?.length, 63);
    assert.ok((filled["1h"]?.length ?? 0) >= 30);
    assert.ok((filled["4h"]?.length ?? 0) >= 30);
    assert.equal(sourceFrame("cronos", "5m"), "5m");
    assert.equal(sourceFrame("cronos", "15m"), "15m");
    assert.equal(sourceFrame("cronos", "1h"), "1h");
    assert.equal(sourceFrame("cronos", "4h"), "4h");
    assert.equal(sourceFrame("solana", "5m"), "5m");
    assert.equal(sourceFrame("solana", "1h"), "15m");
    assert.equal(sourceFrame("solana", "4h"), "4h");
  });
});
