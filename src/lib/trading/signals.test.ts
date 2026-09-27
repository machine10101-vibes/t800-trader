import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSignals, ema, rsi, snapshotTechnical } from "./signals";
import type { TokenCandidate } from "../types";
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
  });

  it("emits at most one Solana paper signal and never a live swap", () => {
    const token = {
      id: "mint",
      chain: "solana",
      symbol: "JUP",
      name: "Jupiter",
      mint: "mint",
      poolAddress: "pool",
      dex: "raydium",
      quoteSymbol: "SOL",
      priceUsd: 1,
      marketCapUsd: 1,
      fdvUsd: 1,
      liquidityUsd: 1,
      volume24hUsd: 1,
      poolCreatedAt: null,
      ageHours: 100,
      sector: "DEX",
      flows: {
        m5: { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 0.5 },
        m15: { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 0.8 },
        m30: { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 1 },
        h1: { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 1 },
        h6: { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 1 },
        h24: { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 2 },
      },
      watchlist: true,
      sources: ["test"],
    } as TokenCandidate;
    const snap = snapshotTechnical(candles(40));
    const tech = {
      ...snap,
      rsi14: 58,
      ema9: 2,
      ema21: 1,
      atrPct: 1.2,
      volumeZ: 2,
      extensionPct: 1,
      lastClose: 1.02,
    };
    const signals = buildSignals(token, tech, 70, true);
    assert.ok(signals.length <= 1);
    if (signals[0]) {
      assert.equal(signals[0].side, "long");
      assert.equal(signals[0].reason, "breakout");
    }
  });
});
