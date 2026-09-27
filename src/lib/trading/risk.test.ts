import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canOpen, dayLossBreached, exitReason, sizePosition } from "./risk";
import { DEFAULT_CONFIG } from "../store";
import type { MarketRegime, Portfolio, Signal } from "../types";

const regime = (stance: MarketRegime["stance"]): MarketRegime =>
  ({
    asOf: new Date().toISOString(),
    btc: { price: 1, change24h: 1, marketCap: 1, volume24h: 1 },
    eth: { price: 1, change24h: 1, marketCap: 1, volume24h: 1 },
    sol: { price: 1, change24h: 1, marketCap: 1, volume24h: 1 },
    btcDominance: 55,
    ethDominance: 12,
    totalMarketCap: 1,
    marketCapChange24h: 1,
    fearGreed: { value: 50, label: "Neutral" },
    solanaTvl: 1,
    solanaDexVolume24h: 1,
    solanaDexVolumeChange1d: 1,
    stance,
    stanceWhy: "",
    crowded: [],
    overlooked: [],
    overview: "",
    narratives: [],
  }) as MarketRegime;

const portfolio = (over: Partial<Portfolio> = {}): Portfolio => ({
  cashUsd: 10_000,
  equityUsd: 10_000,
  peakEquity: 10_000,
  dayStartEquity: 10_000,
  dayPnlUsd: 0,
  realizedPnlUsd: 0,
  unrealizedPnlUsd: 0,
  winCount: 0,
  lossCount: 0,
  tradeCount: 0,
  ...over,
});

describe("risk", () => {
  it("sizes smaller in a defensive regime", () => {
    const riskOn = sizePosition({
      equity: 10_000,
      price: 100,
      stopPct: 2,
      config: DEFAULT_CONFIG,
      regime: regime("risk-on"),
      researchScore: 70,
    });
    const def = sizePosition({
      equity: 10_000,
      price: 100,
      stopPct: 2,
      config: DEFAULT_CONFIG,
      regime: regime("defensive"),
      researchScore: 70,
    });
    assert.ok(def.notional < riskOn.notional);
  });

  it("blocks new risk after the daily loss limit", () => {
    const broke = dayLossBreached(portfolio({ equityUsd: 9_000, dayStartEquity: 10_000 }), {
      ...DEFAULT_CONFIG,
      dailyLossLimitPct: 6,
    });
    assert.equal(broke, true);
  });

  it("blocks a second position in the same mint", () => {
    const signal = {
      id: "s",
      mint: "abc",
      symbol: "ABC",
      poolAddress: "p",
      side: "long",
      reason: "breakout",
      confidence: 70,
      price: 1,
      stopPct: 2,
      targetPct: 4,
      thesis: "t",
      researchScore: 60,
      createdAt: new Date().toISOString(),
    } as Signal;
    const reason = canOpen({
      positions: [
        {
          id: "p",
          mint: "abc",
          symbol: "ABC",
          poolAddress: "p",
          side: "long",
          qty: 1,
          entryPrice: 1,
          markPrice: 1,
          stopPrice: 0.9,
          targetPrice: 1.1,
          openedAt: new Date().toISOString(),
          lastUpdate: new Date().toISOString(),
          reason: "breakout",
          researchScore: 60,
          highWater: 1,
          lowWater: 1,
          notional: 1,
        },
      ],
      signal,
      config: DEFAULT_CONFIG,
      portfolio: portfolio(),
    });
    assert.equal(reason, "Already in this mint");
  });

  it("exits longs on stop, target, trail, and time", () => {
    const base = {
      id: "p",
      mint: "abc",
      symbol: "ABC",
      poolAddress: "p",
      side: "long" as const,
      qty: 1,
      entryPrice: 100,
      markPrice: 100,
      stopPrice: 98,
      targetPrice: 104,
      openedAt: new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
      reason: "breakout" as const,
      researchScore: 60,
      highWater: 100,
      lowWater: 100,
      notional: 100,
    };
    assert.equal(exitReason({ ...base, markPrice: 97.5 }), "stop");
    assert.equal(exitReason({ ...base, markPrice: 104.2 }), "target");
    const locked = 100 + (104 - 100) * 0.55;
    assert.equal(exitReason({ ...base, markPrice: locked - 0.1, highWater: locked + 0.2 }), "trail");
    assert.equal(exitReason(base, Date.now() + 51 * 60_000), "time");
  });

  it("trails a winning short off the favorable extreme, not the adverse wick", () => {
    const entry = 100;
    const target = 90;
    const locked = entry - (entry - target) * 0.55;
    const reason = exitReason({
      id: "p",
      mint: "abc",
      symbol: "ABC",
      poolAddress: "p",
      side: "short",
      qty: 1,
      entryPrice: entry,
      markPrice: locked + 0.4,
      stopPrice: 106,
      targetPrice: target,
      openedAt: new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
      reason: "fade",
      researchScore: 60,
      highWater: locked - 0.3,
      lowWater: 102,
      notional: 100,
    });
    assert.equal(reason, "trail");
  });
});
