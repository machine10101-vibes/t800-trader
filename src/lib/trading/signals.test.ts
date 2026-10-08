import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  atrTradeable,
  buildFlowSignals,
  buildSignals,
  candleSetups,
  ema,
  entrySignals,
  FIFTEEN_MIN_ATR,
  FOUR_HOUR_ATR,
  rewardToRisk,
  rsi,
  snapshotTechnical,
  solanaEntrySignals,
} from "./signals";
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

  it("treats a thin single-print bar as a neutral close, not a weak one", () => {
    const rows = candles(40);
    const last = rows[rows.length - 1]!;
    rows[rows.length - 1] = { ...last, open: last.close, high: last.close, low: last.close, close: last.close };
    const snap = snapshotTechnical(rows);
    assert.equal(snap.closeStrength, 0.5);
  });

  it("lets a 15-minute watchlist name continue without a volume spike", () => {
    const flow = { buys: 50, sells: 50, buyers: 20, sellers: 20, volumeUsd: 1, priceChangePct: 0.1 };
    const token = {
      symbol: "CRO",
      mint: "cro",
      poolAddress: "pool",
      sector: "L1",
      watchlist: true,
      flows: { m5: flow, m15: flow, m30: flow, h1: flow, h6: flow, h24: flow },
    } as TokenCandidate;
    const longTech = {
      rsi14: 58,
      ema9: 1.01,
      ema21: 1,
      vwap: 1,
      atrPct: 0.8,
      volumeZ: -0.8,
      lastClose: 1.005,
      extensionPct: 0.4,
      closeStrength: 0.5,
      priorHigh: 1.05,
      priorLow: 0.98,
      barsAboveEma9: 2,
    } as TechnicalSnapshot;
    const fifteen = candleSetups(token, longTech, 62, true, { stance: "mixed", fearGreed: 55, solChange: 0 }, FIFTEEN_MIN_ATR);
    assert.equal(fifteen.some((signal) => signal.side === "long" && signal.reason === "reclaim"), true);
    assert.equal(candleSetups(token, longTech, 62, true, { stance: "mixed", fearGreed: 55, solChange: 0 }, FOUR_HOUR_ATR).length, 0);
    const shortTech = {
      ...longTech,
      rsi14: 42,
      ema9: 0.99,
      ema21: 1,
      lastClose: 0.995,
      extensionPct: -0.4,
      barsAboveEma9: 0,
      barsBelowEma9: 2,
    } as TechnicalSnapshot;
    const shorts = candleSetups(token, shortTech, 62, true, { stance: "mixed", fearGreed: 55, solChange: 0 }, FIFTEEN_MIN_ATR);
    assert.equal(shorts.some((signal) => signal.side === "short" && signal.reason === "reclaim"), true);
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
    const flat = {
      ...token,
      symbol: "SOL",
      flows: {
        m5: flow(0.2, 48, 52),
        m15: flow(0.02, 48, 52),
        m30: flow(0.1, 48, 52),
        h1: flow(0.4, 48, 52),
        h6: flow(0.2, 48, 52),
        h24: flow(0.4, 48, 52),
      },
    };
    assert.equal(buildFlowSignals(flat, 70, false, { stance: "mixed", fearGreed: 50, solChange: 0.2 }).length, 1);
    const flatRed5 = {
      ...flat,
      flows: {
        ...flat.flows,
        m5: flow(-0.4, 48, 52),
      },
    };
    assert.equal(buildFlowSignals(flatRed5, 70, false, { stance: "mixed", fearGreed: 50, solChange: 0.2 }).length, 0);
    const quietGreen = {
      ...flat,
      flows: {
        ...flat.flows,
        m5: flow(0.009, 1167, 907),
        m15: flow(-0.111, 1167, 907),
        h1: flow(-0.448, 1167, 907),
      },
    };
    assert.equal(buildFlowSignals(quietGreen, 70, true, { stance: "mixed", fearGreed: 50, solChange: -1.2 }).length, 1);
    const unprinted = {
      ...quietGreen,
      flows: {
        ...quietGreen.flows,
        m5: flow(0.009, 0, 0),
        m15: flow(-0.111, 0, 0),
      },
    };
    assert.equal(buildFlowSignals(unprinted, 70, true, { stance: "mixed", fearGreed: 50, solChange: -1.2 }).length, 0);
  });

  it("shorts a falling watchlist name and keeps a candle short", () => {
    const flow = (priceChangePct: number, buys = 40, sells = 60) => ({
      buys,
      sells,
      buyers: 12,
      sellers: 18,
      volumeUsd: 10_000,
      priceChangePct,
    });
    const token = {
      symbol: "SOL",
      mint: "sol",
      poolAddress: "pool",
      sector: "L1",
      watchlist: true,
      priceUsd: 180,
      flows: {
        m5: flow(-0.6),
        m15: flow(-1.4),
        m30: flow(-0.8),
        h1: flow(-1.1),
        h6: flow(-0.4),
        h24: flow(0.2),
      },
    } as TokenCandidate;
    assert.equal(buildFlowSignals(token, 70, false, { stance: "mixed", fearGreed: 50, solChange: -0.4 }).length, 0);
    assert.equal(buildFlowSignals(token, 70, true, { stance: "defensive", fearGreed: 40, solChange: -0.4 }).length, 0);
    const found = buildFlowSignals(token, 70, true, { stance: "mixed", fearGreed: 50, solChange: -0.4 });
    assert.equal(found.length, 1);
    assert.equal(found[0]?.side, "short");
    assert.equal(found[0]?.reason, "fade");
    const climax = {
      ...token,
      priceUsd: 200,
      flows: {
        m5: flow(1, 30, 70),
        m15: flow(2, 30, 70),
        m30: flow(14, 30, 70),
        h1: flow(20, 30, 70),
        h6: flow(8, 30, 70),
        h24: flow(12, 30, 70),
      },
    } as TokenCandidate;
    const tech = {
      rsi14: 82,
      ema9: 200,
      ema21: 190,
      vwap: 170,
      atrPct: 1.2,
      volumeZ: 2,
      lastClose: 200,
      extensionPct: 6,
      closeStrength: 0.2,
      priorHigh: 190,
      priorLow: 160,
      barsAboveEma9: 4,
    } as TechnicalSnapshot;
    const kept = entrySignals(climax, tech, 60, true, { stance: "mixed", fearGreed: 50, solChange: 0.2 });
    assert.equal(kept[0]?.side, "short");
    assert.equal(kept[0]?.reason, "fade");
    const zebec = buildFlowSignals({ ...token, symbol: "ZBCN", mint: "zbcn" }, 70, true, {
      stance: "mixed",
      fearGreed: 50,
      solChange: -0.4,
    });
    assert.equal(zebec.length, 0);
    const mild = {
      ...token,
      flows: {
        m5: flow(-0.11, 52, 48),
        m15: flow(-0.2, 52, 48),
        m30: flow(-0.3, 52, 48),
        h1: flow(-0.5, 52, 48),
        h6: flow(-0.4, 52, 48),
        h24: flow(-0.2, 52, 48),
      },
    };
    const mildShort = buildFlowSignals(mild, 70, true, { stance: "mixed", fearGreed: 50, solChange: -0.4 });
    assert.equal(mildShort.length, 1);
    assert.equal(mildShort[0]?.side, "short");
    const tooFlat = {
      ...mild,
      flows: { ...mild.flows, m15: flow(-0.1, 52, 48) },
    };
    assert.equal(buildFlowSignals(tooFlat, 70, true, { stance: "mixed", fearGreed: 50, solChange: -0.4 }).length, 0);
    const buySpike = {
      ...token,
      flows: {
        ...token.flows,
        m5: flow(-0.4, 80, 20),
        m15: flow(-1.2, 80, 20),
      },
    };
    assert.equal(buildFlowSignals(buySpike, 70, true, { stance: "mixed", fearGreed: 50, solChange: -0.4 }).length, 0);
    const techLong = {
      rsi14: 52,
      ema9: 100,
      ema21: 99,
      vwap: 100,
      atrPct: 1.2,
      volumeZ: 0.2,
      lastClose: 100,
      extensionPct: 0.4,
      closeStrength: 0.6,
      priorHigh: 110,
      priorLow: 90,
      barsAboveEma9: 3,
    } as TechnicalSnapshot;
    const both = {
      ...mild,
      priceUsd: 100,
      flows: { ...mild.flows, h1: flow(-0.2, 52, 48) },
    };
    const structured = buildSignals(both, techLong, 70, true, { stance: "mixed", fearGreed: 50, solChange: -0.4 });
    assert.equal(structured[0]?.side, "long");
    const preferred = entrySignals(both, techLong, 70, true, { stance: "mixed", fearGreed: 50, solChange: -0.4 });
    assert.equal(preferred[0]?.side, "short");
    const solana = solanaEntrySignals(both, techLong, 70, true, { stance: "mixed", fearGreed: 50, solChange: -0.4 });
    const shape = (rows: typeof structured) => rows.map((s) => `${s.side}:${s.reason}:${s.confidence}`);
    assert.deepEqual(shape(solana), shape(structured));
    assert.deepEqual(solanaEntrySignals(both, null, 70, true), []);
    const down = {
      rsi14: 40,
      ema9: 90,
      ema21: 100,
      vwap: 110,
      atrPct: 1.4,
      volumeZ: 1.4,
      lastClose: 88,
      extensionPct: -1,
      closeStrength: 0.2,
      priorHigh: 100,
      priorLow: 90,
      barsAboveEma9: 0,
      barsBelowEma9: 3,
    } as TechnicalSnapshot;
    const falling = {
      ...both,
      symbol: "RAY",
      mint: "ray",
      flows: {
        ...both.flows,
        m15: flow(-0.8, 30, 70),
        m30: flow(-1, 30, 70),
        h1: flow(-1.2, 30, 70),
      },
    };
    const rayShort = solanaEntrySignals(falling, down, 70, true, { stance: "mixed", fearGreed: 50, solChange: -0.4 });
    assert.equal(rayShort[0]?.side, "short");
    assert.equal(rayShort[0]?.reason, "breakout");
    assert.equal(solanaEntrySignals(falling, down, 70, false, { stance: "mixed", fearGreed: 50, solChange: -0.4 }).some((s) => s.side === "short"), false);
    const dip = {
      ...down,
      rsi14: 48,
      ema9: 102,
      ema21: 100,
      vwap: 80,
      volumeZ: 0.2,
      lastClose: 101,
      extensionPct: 0.2,
      closeStrength: 0.4,
      priorHigh: 110,
      priorLow: 90,
      barsAboveEma9: 0,
      barsBelowEma9: 0,
    } as TechnicalSnapshot;
    const dipped = { ...falling, watchlist: true, priceUsd: 101 };
    assert.equal(solanaEntrySignals(dipped, dip, 70, true, { stance: "mixed", fearGreed: 50, solChange: 0 }).some((s) => s.side === "short"), false);
    const grind = {
      ...dip,
      ema9: 96,
      ema21: 100,
      volumeZ: 1.2,
      lastClose: 97,
      priorHigh: 110,
      barsBelowEma9: 3,
    } as TechnicalSnapshot;
    const grinding = { ...dipped, priceUsd: 97 };
    const cont = solanaEntrySignals(grinding, grind, 70, true, { stance: "mixed", fearGreed: 50, solChange: 0 });
    assert.equal(cont[0]?.side, "short");
    assert.equal(cont[0]?.reason, "reclaim");
    const hot = { ...grind, rsi14: 82, ema9: 110, ema21: 100, barsBelowEma9: 0, barsAboveEma9: 3, lastClose: 108, priorLow: 90 } as TechnicalSnapshot;
    const ripped = solanaEntrySignals({ ...grinding, watchlist: false, priceUsd: 108 }, hot, 70, true, { stance: "mixed", fearGreed: 50, solChange: 0 });
    assert.equal(ripped[0]?.side, "short");
    assert.equal(ripped[0]?.reason, "reclaim");
    const warm = { ...hot, rsi14: 70 } as TechnicalSnapshot;
    assert.equal(solanaEntrySignals({ ...grinding, watchlist: false, priceUsd: 108 }, warm, 70, true, { stance: "mixed", fearGreed: 50, solChange: 0 }).some((s) => s.side === "short"), false);
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
