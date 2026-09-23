import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canOpen, cashConcentration, consecutiveLosses, dayLossBreached, managePosition, MIN_TICKET_USD, sizePosition } from "./risk";
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
      sector: "DEX",
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
          sector: "DEX",
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
          initialStop: 0.9,
          scaled: false,
        },
      ],
      signal,
      config: DEFAULT_CONFIG,
      portfolio: portfolio(),
    });
    assert.equal(reason, "Already in this mint");
  });

  it("blocks a third ticket in the same sector", () => {
    const signal = {
      id: "s2",
      mint: "def",
      symbol: "DEF",
      poolAddress: "q",
      sector: "DEX",
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
    const pos = (mint: string) => ({
      id: mint,
      mint,
      symbol: mint,
      poolAddress: mint,
      sector: "DEX" as const,
      side: "long" as const,
      qty: 1,
      entryPrice: 1,
      markPrice: 1,
      stopPrice: 0.9,
      targetPrice: 1.1,
      openedAt: new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
      reason: "breakout" as const,
      researchScore: 60,
      highWater: 1,
      lowWater: 1,
      notional: 1,
      initialStop: 0.9,
      scaled: false,
    });
    const reason = canOpen({
      positions: [pos("aaa"), pos("bbb")],
      signal,
      config: DEFAULT_CONFIG,
      portfolio: portfolio(),
    });
    assert.equal(reason, "Already two DEX tickets");
  });

  it("blocks shorts when the tape is defensive", () => {
    const signal = {
      id: "s3",
      mint: "xyz",
      symbol: "XYZ",
      poolAddress: "z",
      sector: "Meme",
      side: "short",
      reason: "fade",
      confidence: 80,
      price: 1,
      stopPct: 2,
      targetPct: 4,
      thesis: "t",
      researchScore: 60,
      createdAt: new Date().toISOString(),
    } as Signal;
    const reason = canOpen({
      positions: [],
      signal,
      config: DEFAULT_CONFIG,
      portfolio: portfolio(),
      stance: "defensive",
    });
    assert.equal(reason, "No shorts in a defensive tape");
  });

  it("blocks a fourth attempt after three straight losses", () => {
    const signal = {
      id: "s4",
      mint: "zzz",
      symbol: "ZZZ",
      poolAddress: "z",
      sector: "L1",
      side: "long",
      reason: "breakout",
      confidence: 80,
      price: 1,
      stopPct: 2,
      targetPct: 4,
      thesis: "t",
      researchScore: 70,
      createdAt: new Date().toISOString(),
    } as Signal;
    const reason = canOpen({
      positions: [],
      signal,
      config: DEFAULT_CONFIG,
      portfolio: portfolio(),
      trades: [
        { action: "close", pnlUsd: -10, mint: "a", at: new Date().toISOString() } as never,
        { action: "close", pnlUsd: -8, mint: "b", at: new Date().toISOString() } as never,
        { action: "close", pnlUsd: -3, mint: "c", at: new Date().toISOString() } as never,
      ],
    });
    assert.equal(reason, "Cooling after a three-loss streak");
  });

  it("sizes down after a two-loss streak", () => {
    const fresh = sizePosition({
      equity: 10_000,
      price: 100,
      stopPct: 6,
      config: DEFAULT_CONFIG,
      regime: regime("risk-on"),
      researchScore: 70,
      lossStreak: 0,
    });
    const hurt = sizePosition({
      equity: 10_000,
      price: 100,
      stopPct: 6,
      config: DEFAULT_CONFIG,
      regime: regime("risk-on"),
      researchScore: 70,
      lossStreak: 2,
    });
    assert.ok(hurt.notional < fresh.notional);
  });

  it("counts consecutive closed losses", () => {
    const n = consecutiveLosses([
      { action: "close", pnlUsd: -12 } as never,
      { action: "close", pnlUsd: -4 } as never,
      { action: "close", pnlUsd: 9 } as never,
    ]);
    assert.equal(n, 2);
  });

  it("lets a $5 wallet open and sizes a $6 book above the ticket floor", () => {
    const signal = {
      id: "s5",
      mint: "sol",
      symbol: "SOL",
      poolAddress: "pool",
      sector: "L1",
      side: "long",
      reason: "breakout",
      confidence: 80,
      price: 140,
      stopPct: 2,
      targetPct: 4,
      thesis: "t",
      researchScore: 70,
      createdAt: new Date().toISOString(),
    } as Signal;
    const five = canOpen({
      positions: [],
      signal,
      config: DEFAULT_CONFIG,
      portfolio: portfolio({ cashUsd: 5, equityUsd: 5, peakEquity: 5, dayStartEquity: 5 }),
      stance: "risk-on",
    });
    assert.equal(five, null);

    const four = canOpen({
      positions: [],
      signal,
      config: DEFAULT_CONFIG,
      portfolio: portfolio({ cashUsd: 4, equityUsd: 4, peakEquity: 4, dayStartEquity: 4 }),
      stance: "risk-on",
    });
    assert.equal(four, "Insufficient cash");

    const sized = sizePosition({
      equity: 6,
      price: 140,
      stopPct: 2,
      config: DEFAULT_CONFIG,
      regime: regime("risk-on"),
      researchScore: 70,
      confidence: 80,
    });
    assert.ok(sized.notional >= MIN_TICKET_USD);
    assert.ok(sized.notional <= 6 * cashConcentration(6));
    assert.ok(sized.qty > 0);

    const defensive = sizePosition({
      equity: 5,
      price: 140,
      stopPct: 6,
      config: DEFAULT_CONFIG,
      regime: regime("defensive"),
      researchScore: 50,
    });
    assert.ok(defensive.notional >= 1);
    assert.ok(defensive.notional <= 5 * 0.6);
  });

  it("moves a winner to breakeven and asks to scale at 1R", () => {
    const plan = managePosition({
      id: "p",
      mint: "m",
      symbol: "SOL",
      poolAddress: "x",
      sector: "L1",
      side: "long",
      qty: 10,
      entryPrice: 100,
      markPrice: 103,
      stopPrice: 98,
      targetPrice: 106,
      openedAt: new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
      reason: "breakout",
      researchScore: 70,
      highWater: 103,
      lowWater: 100,
      notional: 1030,
      initialStop: 98,
      scaled: false,
    });
    assert.ok((plan.nextStop ?? 0) >= 100);
    assert.equal(plan.scale, true);
  });
});
