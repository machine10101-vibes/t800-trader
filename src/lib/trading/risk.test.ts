import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canOpen, cashConcentration, consecutiveLosses, dayLossBreached, managePosition, MIN_TICKET_USD, rollSession, shouldScratch, sizePosition, spendableUsd, walletRiskBook } from "./risk";
import { DEFAULT_CONFIG } from "../store";
import type { MarketRegime, Portfolio, Position, Signal } from "../types";

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
    assert.equal(reason, "Sector cap of 2 reached for DEX");
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
    assert.equal(reason, "Cooling after 3 straight losses");
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

  it("lets a $3 wallet open and sizes a $6 book above the ticket floor", () => {
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
    const three = canOpen({
      positions: [],
      signal,
      config: DEFAULT_CONFIG,
      portfolio: portfolio({ cashUsd: 3, equityUsd: 3, peakEquity: 3, dayStartEquity: 3 }),
      stance: "risk-on",
    });
    assert.equal(three, null);

    const two = canOpen({
      positions: [],
      signal,
      config: DEFAULT_CONFIG,
      portfolio: portfolio({ cashUsd: 2, equityUsd: 2, peakEquity: 2, dayStartEquity: 2 }),
      stance: "risk-on",
    });
    assert.equal(two, "Insufficient cash");

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

  it("keeps a micro book on one ticket", () => {
    const signal = {
      id: "s6",
      mint: "jup",
      symbol: "JUP",
      poolAddress: "pool",
      sector: "DEX",
      side: "long",
      reason: "reclaim",
      confidence: 74,
      price: 1,
      stopPct: 1.4,
      targetPct: 2.8,
      thesis: "t",
      researchScore: 70,
      createdAt: new Date().toISOString(),
    } as Signal;
    const held = {
      id: "p",
      mint: "sol",
      symbol: "SOL",
      poolAddress: "p",
      sector: "L1",
      side: "long" as const,
      qty: 1,
      entryPrice: 1,
      markPrice: 1,
      stopPrice: 0.98,
      targetPrice: 1.03,
      openedAt: new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
      reason: "reclaim" as const,
      researchScore: 70,
      highWater: 1,
      lowWater: 1,
      notional: 2,
      initialStop: 0.98,
      scaled: false,
    } as Position;
    const reason = canOpen({
      positions: [held],
      signal,
      config: DEFAULT_CONFIG,
      portfolio: portfolio({ cashUsd: 4, equityUsd: 6, peakEquity: 6, dayStartEquity: 6 }),
      stance: "defensive",
    });
    assert.equal(reason, "Micro book rides one ticket");
  });

  it("scratches a long when 5m and 15m both flip and the trade is not working", () => {
    const pos = {
      id: "p",
      mint: "m",
      symbol: "JUP",
      poolAddress: "x",
      sector: "DEX" as const,
      side: "long" as const,
      qty: 1,
      entryPrice: 100,
      markPrice: 99.8,
      stopPrice: 98,
      targetPrice: 103,
      openedAt: new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
      reason: "reclaim" as const,
      researchScore: 70,
      highWater: 100,
      lowWater: 99.8,
      notional: 99.8,
      initialStop: 98,
      scaled: false,
    };
    assert.equal(shouldScratch(pos, -0.8, -1.4), true);
    assert.equal(shouldScratch({ ...pos, markPrice: 101.2, highWater: 101.2 }, -0.8, -1.4), false);
  });

  it("rolls yesterday's loss cap so a new session can trade", () => {
    const rolled = rollSession(
      { ...portfolio({ equityUsd: 6, dayStartEquity: 10, dayPnlUsd: -4 }), sessionDay: "2020-01-01" },
      new Date("2026-09-23T12:00:00Z"),
    );
    assert.equal(rolled.sessionDay, "2026-09-23");
    assert.equal(rolled.dayStartEquity, 6);
    assert.equal(rolled.dayPnlUsd, 0);
  });

  it("lets a flat watchlist trade work past 12 minutes", () => {
    const openedAt = new Date(Date.now() - 20 * 60_000).toISOString();
    const plan = managePosition({
      id: "p",
      mint: "m",
      symbol: "SOL",
      poolAddress: "x",
      sector: "L1",
      side: "long",
      qty: 1,
      entryPrice: 100,
      markPrice: 100,
      stopPrice: 98,
      targetPrice: 104,
      openedAt,
      lastUpdate: openedAt,
      reason: "reclaim",
      researchScore: 70,
      highWater: 100,
      lowWater: 100,
      notional: 100,
      initialStop: 98,
      scaled: false,
    });
    assert.equal(plan.exit, undefined);
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

  it("follows a custom sector cap, confidence floor, and cash override", () => {
    const tight = { ...DEFAULT_CONFIG, maxPerSector: 1, minConfidence: 80, lossStreakPause: 0 };
    const signal = {
      id: "s",
      mint: "ccc",
      symbol: "ORCA",
      poolAddress: "p",
      sector: "DEX",
      side: "long" as const,
      reason: "reclaim" as const,
      confidence: 70,
      price: 1,
      stopPct: 2,
      targetPct: 4,
      thesis: "t",
      researchScore: 70,
      createdAt: new Date().toISOString(),
    } as Signal;
    assert.equal(
      canOpen({ positions: [], signal, config: tight, portfolio: portfolio() }),
      "Confidence below the quality floor",
    );
    assert.equal(
      canOpen({
        positions: [],
        signal: { ...signal, confidence: 82 } as Signal,
        config: { ...tight, maxPerSector: 1 },
        portfolio: portfolio(),
      }),
      null,
    );
    assert.equal(cashConcentration(6, { autoCash: false, cashPct: 50 }), 0.5);
    assert.equal(cashConcentration(6), 0.92);
    const held = managePosition(
      {
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
      },
      Date.now(),
      { beR: 0.8, scaleAtR: 2 },
    );
    assert.equal(held.scale, undefined);
    assert.ok((held.nextStop ?? 0) >= 100);
  });
});

describe("walletRiskBook", () => {
  it("sizes a live ticket from the wallet and ignores unsigned paper rows", () => {
    assert.ok(Math.abs(spendableUsd({ usdc: 10, sol: 0.2, solPriceUsd: 100 }) - 19.6) < 1e-6);
    const smallSol = spendableUsd({ usdc: 0, sol: 0.02, solPriceUsd: 190 });
    assert.ok(smallSol >= 3, `0.02 SOL at $190 should still spend about $3, got ${smallSol}`);
    const paper = {
      cashUsd: 0,
      equityUsd: 40,
      peakEquity: 40,
      dayStartEquity: 80,
      dayPnlUsd: -40,
      realizedPnlUsd: -40,
      unrealizedPnlUsd: 0,
      winCount: 0,
      lossCount: 4,
      tradeCount: 4,
      sessionDay: "2026-09-24",
    };
    const unsigned = {
      id: "paper",
      signature: undefined,
      qty: 1,
      markPrice: 40,
    } as never;
    const risk = walletRiskBook(paper, [unsigned], [{ signature: undefined } as never], { usdc: 12, sol: 0.05, solPriceUsd: 100 }, true);
    assert.equal(risk.positions.length, 0);
    assert.equal(risk.trades.length, 0);
    assert.equal(risk.portfolio.cashUsd, 12);
    assert.equal(risk.portfolio.dayPnlUsd, 0);
    assert.equal(dayLossBreached(risk.portfolio, { ...DEFAULT_CONFIG, dailyLossLimitPct: 6 }), false);
  });
});
