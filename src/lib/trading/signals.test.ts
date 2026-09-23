import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { atrTradeable, buildSignals, ema, rewardToRisk, rsi, snapshotTechnical } from "./signals";
import type { Candle, TechnicalSnapshot, TokenCandidate } from "../types";

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

  it("lets a liquid watchlist name continue when the 5m range is held", () => {
    const flow = { buys: 60, sells: 40, buyers: 30, sellers: 20, volumeUsd: 1, priceChangePct: 0.4 };
    const token = {
      symbol: "JUP",
      mint: "jup",
      poolAddress: "pool",
      sector: "DEX",
      watchlist: true,
      flows: { m5: flow, m15: flow, m30: flow, h1: { ...flow, priceChangePct: 1.2 }, h6: flow, h24: flow },
    } as TokenCandidate;
    const tech = {
      rsi14: 54,
      ema9: 1.02,
      ema21: 1,
      vwap: 1,
      atrPct: 1.2,
      volumeZ: 0.1,
      lastClose: 1.01,
      extensionPct: 0.4,
      closeStrength: 0.62,
      priorHigh: 1.05,
      priorLow: 0.98,
      barsAboveEma9: 3,
    } as TechnicalSnapshot;
    const found = buildSignals(token, tech, 62, true, { stance: "mixed", fearGreed: 55, solChange: -0.4 });
    assert.equal(found.length, 1);
    assert.equal(found[0]?.side, "long");
    assert.ok(found[0]!.confidence >= 58);
  });

  it("stays flat when a watchlist name is breaking down", () => {
    const flow = { buys: 40, sells: 60, buyers: 10, sellers: 20, volumeUsd: 1, priceChangePct: -1 };
    const token = {
      symbol: "JUP",
      mint: "jup",
      poolAddress: "pool",
      sector: "DEX",
      watchlist: true,
      flows: { m5: flow, m15: flow, m30: flow, h1: { ...flow, priceChangePct: -3 }, h6: flow, h24: flow },
    } as TokenCandidate;
    const tech = {
      rsi14: 38,
      ema9: 0.9,
      ema21: 1,
      vwap: 1,
      atrPct: 1.4,
      volumeZ: -0.2,
      lastClose: 0.9,
      extensionPct: -2,
      closeStrength: 0.1,
      priorHigh: 1.05,
      priorLow: 0.95,
      barsAboveEma9: 0,
    } as TechnicalSnapshot;
    const found = buildSignals(token, tech, 60, true, { stance: "mixed", fearGreed: 50, solChange: -1 });
    assert.equal(found.length, 0);
  });

  it("requires at least 1.6R", () => {
    assert.ok(rewardToRisk(1, 1.7) >= 1.6);
    assert.ok(rewardToRisk(2, 2) < 1.6);
  });
});
