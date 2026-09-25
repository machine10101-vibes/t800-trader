import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { atrTradeable, buildFlowSignals, buildSignals, ema, entrySignals, rewardToRisk, rsi, snapshotTechnical } from "./signals";
import { canOpen, cashConcentration, sizePosition } from "./risk";
import { DEFAULT_CONFIG } from "../store";
import type { Candle, MarketRegime, TechnicalSnapshot, TokenCandidate } from "../types";

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

  it("buys a watchlist name only when the 15m is green", () => {
    const flow = (priceChangePct: number, buys = 58, sells = 42) => ({
      buys,
      sells,
      buyers: 20,
      sellers: 18,
      volumeUsd: 10_000,
      priceChangePct,
    });
    const red = {
      symbol: "SOL",
      mint: "sol",
      poolAddress: "pool",
      sector: "L1",
      watchlist: true,
      priceUsd: 115,
      flows: {
        m5: flow(-0.1),
        m15: flow(-0.3),
        m30: flow(0.2),
        h1: flow(-0.6),
        h6: flow(-1),
        h24: flow(-1.5),
      },
    } as TokenCandidate;
    assert.equal(buildFlowSignals(red, 67, true, { stance: "defensive", fearGreed: 71, solChange: -1.8 }).length, 0);
    const token = {
      ...red,
      symbol: "JUP",
      mint: "jup",
      flows: {
        m5: flow(0.25),
        m15: flow(0.45),
        m30: flow(0.3),
        h1: flow(0.8),
        h6: flow(0.4),
        h24: flow(1.1),
      },
    } as TokenCandidate;
    const found = buildFlowSignals(token, 67, true, { stance: "defensive", fearGreed: 71, solChange: -1.8 });
    const quietChart = entrySignals(
      token,
      {
        rsi14: null,
        ema9: null,
        ema21: null,
        vwap: null,
        atrPct: null,
        volumeZ: null,
        lastClose: null,
        extensionPct: null,
        closeStrength: null,
        priorHigh: null,
        priorLow: null,
        barsAboveEma9: 0,
      },
      67,
      true,
      { stance: "defensive", fearGreed: 71, solChange: -1.8 },
    );
    assert.equal(quietChart.length, 1);
    assert.equal(quietChart[0]?.symbol, "JUP");
    assert.equal(found.length, 1);
    assert.equal(found[0]?.side, "long");
    assert.equal(found[0]?.reason, "reclaim");
    assert.ok((found[0]?.confidence ?? 0) >= 58);
    const signal = found[0]!;
    const book = {
      cashUsd: 6,
      equityUsd: 6,
      peakEquity: 6,
      dayStartEquity: 6,
      dayPnlUsd: 0,
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 0,
      winCount: 0,
      lossCount: 0,
      tradeCount: 0,
    };
    assert.equal(
      canOpen({ positions: [], signal, config: DEFAULT_CONFIG, portfolio: book, stance: "defensive" }),
      null,
    );
    const sized = sizePosition({
      equity: 6,
      price: signal.price,
      stopPct: signal.stopPct,
      config: DEFAULT_CONFIG,
      regime: { stance: "defensive" } as MarketRegime,
      researchScore: 67,
      confidence: signal.confidence,
    });
    assert.ok(sized.notional >= 1);
    assert.ok(sized.notional <= 6 * cashConcentration(6));
  });

  it("buys a green 15m watchlist name when the hour is still slightly red", () => {
    const flow = (priceChangePct: number, buys = 58, sells = 40) => ({
      buys,
      sells,
      buyers: 20,
      sellers: 16,
      volumeUsd: 10_000,
      priceChangePct,
    });
    const token = {
      symbol: "JUP",
      mint: "jup",
      poolAddress: "pool",
      sector: "DEX",
      watchlist: true,
      priceUsd: 1.2,
      flows: {
        m5: flow(0.2),
        m15: flow(0.4),
        m30: flow(0.1),
        h1: flow(-0.6),
        h6: flow(0.2),
        h24: flow(1),
      },
    } as TokenCandidate;
    const found = buildFlowSignals(token, 70, false, { stance: "mixed", fearGreed: 50, solChange: 0.2 });
    assert.equal(found.length, 1);
    assert.equal(found[0]?.side, "long");
    const unknown = { ...token, symbol: "PUMP", sector: "Unknown" as const, watchlist: false } as TokenCandidate;
    assert.equal(buildFlowSignals(unknown, 70, false, { stance: "mixed", fearGreed: 50, solChange: 0.2 }).length, 0);
    const bid = {
      ...token,
      flows: {
        m5: flow(1.1, 45, 55),
        m15: flow(2, 45, 55),
        m30: flow(0.4, 45, 55),
        h1: flow(0.7, 45, 55),
        h6: flow(0.2, 45, 55),
        h24: flow(1, 45, 55),
      },
    };
    assert.equal(buildFlowSignals(bid, 70, false, { stance: "mixed", fearGreed: 50, solChange: 0.2 }).length, 1);
    const sold = {
      ...token,
      flows: {
        m5: flow(2.3, 20, 41),
        m15: flow(2, 20, 41),
        m30: flow(0.4, 20, 41),
        h1: flow(0.7, 20, 41),
        h6: flow(0.2, 20, 41),
        h24: flow(1, 20, 41),
      },
    };
    const risingSold = buildFlowSignals(sold, 70, false, { stance: "mixed", fearGreed: 50, solChange: 0.2 });
    assert.equal(risingSold.length, 1);
    assert.equal(risingSold[0]?.side, "long");
    const thin = {
      ...token,
      flows: {
        m5: flow(2.3, 10, 40),
        m15: flow(2, 10, 40),
        m30: flow(0.4, 10, 40),
        h1: flow(0.7, 10, 40),
        h6: flow(0.2, 10, 40),
        h24: flow(1, 10, 40),
      },
    };
    assert.equal(buildFlowSignals(thin, 70, false, { stance: "mixed", fearGreed: 50, solChange: 0.2 }).length, 0);
    const modest = {
      ...token,
      flows: {
        m5: flow(0.02, 40, 60),
        m15: flow(0.2, 40, 60),
        m30: flow(0.1, 40, 60),
        h1: flow(1, 40, 60),
        h6: flow(0.2, 40, 60),
        h24: flow(1, 40, 60),
      },
    };
    assert.equal(buildFlowSignals(modest, 70, false, { stance: "mixed", fearGreed: 50, solChange: 0.2 }).length, 1);
  });

  it("does not buy a crashing watchlist name from pool flow", () => {
    const flow = (priceChangePct: number) => ({
      buys: 30,
      sells: 70,
      buyers: 8,
      sellers: 20,
      volumeUsd: 10_000,
      priceChangePct,
    });
    const token = {
      symbol: "SOL",
      mint: "sol",
      poolAddress: "pool",
      sector: "L1",
      watchlist: true,
      priceUsd: 115,
      flows: {
        m5: flow(-4),
        m15: flow(-5),
        m30: flow(-6),
        h1: flow(-8),
        h6: flow(-8),
        h24: flow(-8),
      },
    } as TokenCandidate;
    const found = buildFlowSignals(token, 60, true, { stance: "defensive", fearGreed: 40, solChange: -6 });
    assert.equal(found.length, 0);
  });

  it("requires at least 1.6R", () => {
    assert.ok(rewardToRisk(1, 1.7) >= 1.6);
    assert.ok(rewardToRisk(2, 2) < 1.6);
  });
});
