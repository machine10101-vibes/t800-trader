import { SOL_MINT } from "@/lib/market/universe";
import type { Candle, MarketRegime, Signal, TechnicalSnapshot, TokenCandidate } from "@/lib/types";
import { clamp, id, mean, stdev } from "@/lib/utils";

/** ATR% range a frame can trade. A 15-minute bar is a quarter of the 4-hour swing. */
export type AtrBand = readonly [number, number];
export const FOUR_HOUR_ATR: AtrBand = [0.45, 5.2];
export const FIFTEEN_MIN_ATR: AtrBand = [0.12, 3.2];

export interface SignalContext {
  stance: MarketRegime["stance"];
  fearGreed: number | null;
  solChange: number;
}

function solOnlyShort(token: { symbol: string; mint: string }): boolean {
  return token.symbol === "SOL" || token.mint === SOL_MINT;
}

function buyShare(buys: number, sells: number): number {
  const t = buys + sells;
  return t > 0 ? buys / t : 0.5;
}

export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = mean(values.slice(0, period));
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

export function atrPct(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const c = candles[i];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
    trs.push(tr);
  }
  const slice = trs.slice(-period);
  const last = candles[candles.length - 1].close;
  if (last <= 0) return null;
  return (mean(slice) / last) * 100;
}

export function vwap(candles: Candle[]): number | null {
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    vol += c.volume;
  }
  if (vol <= 0) return null;
  return pv / vol;
}

export function atrTradeable(atr: number, band: AtrBand = FOUR_HOUR_ATR): boolean {
  return atr >= band[0] && atr <= band[1];
}

export function rewardToRisk(stopPct: number, targetPct: number): number {
  if (stopPct <= 0) return 0;
  return targetPct / stopPct;
}

function withMinRR(stopPct: number, targetPct: number, min = 1.65): { stopPct: number; targetPct: number } {
  return { stopPct, targetPct: Math.max(targetPct, stopPct * min) };
}

export function snapshotTechnical(candles: Candle[]): TechnicalSnapshot {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const last = closes[closes.length - 1] ?? null;
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const vw = vwap(candles.slice(-24));
  const volMean = mean(volumes.slice(0, -1));
  const volSd = stdev(volumes.slice(0, -1));
  const lastVol = volumes[volumes.length - 1] ?? 0;
  const volumeZ = volSd > 0 ? (lastVol - volMean) / volSd : null;
  const extensionPct = last && vw ? ((last - vw) / vw) * 100 : null;
  const bar = candles[candles.length - 1];
  const range = bar ? bar.high - bar.low : 0;
  const closeStrength = bar && range > 0 ? (bar.close - bar.low) / range : null;
  const prior = candles.slice(-13, -1);
  const priorHigh = prior.length ? Math.max(...prior.map((c) => c.high)) : null;
  const priorLow = prior.length ? Math.min(...prior.map((c) => c.low)) : null;
  let barsAboveEma9 = 0;
  let barsBelowEma9 = 0;
  if (e9 !== null) {
    for (let i = candles.length - 1; i >= 0; i--) {
      const window = closes.slice(0, i + 1);
      const e = ema(window, 9);
      if (e === null || closes[i] <= e) break;
      barsAboveEma9 += 1;
      if (barsAboveEma9 >= 8) break;
    }
    for (let i = candles.length - 1; i >= 0; i--) {
      const window = closes.slice(0, i + 1);
      const e = ema(window, 9);
      if (e === null || closes[i] >= e) break;
      barsBelowEma9 += 1;
      if (barsBelowEma9 >= 8) break;
    }
  }
  return {
    rsi14: rsi(closes, 14),
    ema9: e9,
    ema21: e21,
    vwap: vw,
    atrPct: atrPct(candles, 14),
    volumeZ,
    lastClose: last,
    extensionPct,
    closeStrength,
    priorHigh,
    priorLow,
    barsAboveEma9,
    barsBelowEma9,
  };
}

export function buildSignals(
  token: TokenCandidate,
  tech: TechnicalSnapshot,
  researchScore: number | null,
  allowShorts: boolean,
  ctx: SignalContext | MarketRegime["stance"] = "mixed",
  band: AtrBand = FOUR_HOUR_ATR,
): Signal[] {
  const stance = typeof ctx === "string" ? ctx : ctx.stance;
  const fearGreed = typeof ctx === "string" ? null : ctx.fearGreed;
  const solChange = typeof ctx === "string" ? 0 : ctx.solChange;
  if (!tech.lastClose || !tech.rsi14 || !tech.ema9 || !tech.ema21 || !tech.atrPct) return [];
  if (!atrTradeable(tech.atrPct, band)) return [];
  const price = tech.lastClose;
  const atr = Math.max(tech.atrPct, 0.6);
  const volZ = tech.volumeZ ?? 0;
  const ext = tech.extensionPct ?? 0;
  const h15 = token.flows.m15.priceChangePct;
  const h30 = token.flows.m30.priceChangePct;
  const h1 = token.flows.h1.priceChangePct;
  const tape = buyShare(token.flows.m15.buys, token.flows.m15.sells);
  const closeOk = (tech.closeStrength ?? 0) >= 0.58;
  const trueBreak = tech.priorHigh !== null && price >= tech.priorHigh;
  const signals: Signal[] = [];

  const base = {
    mint: token.mint,
    symbol: token.symbol,
    poolAddress: token.poolAddress,
    sector: token.sector,
    price,
    researchScore,
    createdAt: new Date().toISOString(),
  };

  const greedyMemes = token.sector === "Meme" && fearGreed !== null && fearGreed >= 75;
  const solDump = solChange < -2.8;
  const trendUp = tech.ema9 > tech.ema21 && h1 > -1.5 && tech.barsAboveEma9 >= 2;
  const notEuphoric = tech.rsi14 < 70 && ext < 4.8 && volZ < 5.2;
  const allowBreakout =
    !greedyMemes &&
    !(solDump && !token.watchlist) &&
    (stance !== "defensive" || (token.watchlist && (researchScore ?? 0) >= 70));

  if (allowBreakout && trendUp && notEuphoric && trueBreak && closeOk && volZ > 1.05 && h15 > 0.35 && tech.rsi14 > 52 && tape >= 0.53) {
    const rr = withMinRR(clamp(atr * 1.25, 0.8, 3.6), clamp(atr * 2.15, 1.4, 6.8));
    signals.push({
      ...base,
      id: id("sig"),
      side: "long",
      reason: "breakout",
      confidence: clamp(60 + volZ * 5 + (researchScore ? (researchScore - 50) * 0.22 : 0) + (token.watchlist ? 3 : 0), 52, 93),
      ...rr,
      thesis: `${token.symbol} closed above the prior 12-bar high with EMA9>EMA21, RSI ${tech.rsi14.toFixed(0)}, buy share ${(tape * 100).toFixed(0)}%. Structure breakout — not a chase.`,
    });
  }

  const notKnife = h1 > -7 && h30 > -14;
  if (tech.rsi14 < 33 && volZ > 0.35 && ext < 0.8 && notKnife && tape >= 0.48 && (tech.closeStrength ?? 0) >= 0.45) {
    const rr = withMinRR(clamp(atr * 1.15, 0.7, 3.2), clamp(atr * 2.0, 1.3, 5.8));
    signals.push({
      ...base,
      id: id("sig"),
      side: "long",
      reason: "reclaim",
      confidence: clamp(58 + (33 - tech.rsi14) + (researchScore ? (researchScore - 45) * 0.15 : 0), 52, 88),
      ...rr,
      thesis: `${token.symbol} RSI ${tech.rsi14.toFixed(0)} with a firm close and no 1h knife. Mean-reversion long only while liquidity holds.`,
    });
  }

  const heldLow = tech.priorLow !== null && price >= tech.priorLow;
  const flatToUp = tech.ema9 >= tech.ema21 * 0.998 || tech.barsAboveEma9 >= 2;
  if (
    signals.length === 0 &&
    token.watchlist &&
    stance !== "defensive" &&
    !solDump &&
    flatToUp &&
    heldLow &&
    tech.rsi14 >= 46 &&
    tech.rsi14 <= 66 &&
    ext < 3.2 &&
    (tech.closeStrength ?? 0) >= 0.45 &&
    tape >= 0.49 &&
    h1 > -0.5 &&
    volZ > -0.5
  ) {
    const rr = withMinRR(clamp(atr * 1.05, 0.7, 2.8), clamp(atr * 1.9, 1.2, 5.2));
    signals.push({
      ...base,
      id: id("sig"),
      side: "long",
      reason: "reclaim",
      confidence: clamp(64 + (tech.rsi14 - 50) * 0.25, 60, 84),
      ...rr,
      thesis: `${token.symbol} is a liquid watchlist name holding its 5m range with RSI ${tech.rsi14.toFixed(0)} and the hour still bid. Small continuation — not a breakout chase.`,
    });
  }

  const nearVwap =
    tech.vwap !== null && price <= tech.vwap * 1.004 && price >= tech.vwap * 0.992 && tech.rsi14 >= 46 && tech.rsi14 <= 58;
  if (!solDump && trendUp && nearVwap && volZ > 0.2 && volZ < 4 && tape >= 0.51 && stance !== "defensive") {
    const rr = withMinRR(clamp(atr * 1.1, 0.7, 3.0), clamp(atr * 1.95, 1.25, 5.4));
    signals.push({
      ...base,
      id: id("sig"),
      side: "long",
      reason: "reclaim",
      confidence: clamp(59 + volZ * 3.5 + (researchScore ? (researchScore - 50) * 0.16 : 0), 54, 86),
      ...rr,
      thesis: `${token.symbol} is sitting on VWAP with a live 5m uptrend. Pullback long — abort if EMA9 fails.`,
    });
  }

  const solNotRipping = solChange < 3.2;
  if (
    allowShorts &&
    solOnlyShort(token) &&
    stance === "mixed" &&
    solNotRipping &&
    (h30 > 12 || h1 > 19) &&
    tech.rsi14 > 78 &&
    ext > 5 &&
    tape <= 0.46 &&
    (tech.closeStrength ?? 1) <= 0.4
  ) {
    const rr = withMinRR(clamp(atr * 1.4, 1.0, 4.2), clamp(atr * 2.2, 1.6, 6.5));
    signals.push({
      ...base,
      id: id("sig"),
      side: "short",
      reason: "fade",
      confidence: clamp(58 + Math.min(h30, 25) * 0.55, 54, 90),
      ...rr,
      thesis: `${token.symbol} climax (${h30.toFixed(1)}% / 30m, RSI ${tech.rsi14.toFixed(0)}, weak close). Fade — time-boxed, no hero shorts.`,
    });
  }

  return signals
    .filter((s) => rewardToRisk(s.stopPct, s.targetPct) >= 1.6)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 1);
}

/** Score the book from pool flow when 5m candles are rate-limited. */
export function technicalFromFlows(token: TokenCandidate): TechnicalSnapshot {
  const price = token.priceUsd > 0 ? token.priceUsd : 0;
  const h1 = token.flows.h1.priceChangePct;
  const m15 = token.flows.m15.priceChangePct;
  const tape = buyShare(token.flows.m15.buys, token.flows.m15.sells);
  const runRate = token.volume24hUsd > 0 ? token.volume24hUsd / 24 : 0;
  const burst = runRate > 0 ? token.flows.h1.volumeUsd / runRate : 1;
  return {
    rsi14: clamp(50 + h1 * 2.4 + m15 * 1.2, 8, 92),
    ema9: price,
    ema21: price * (1 - h1 / 200),
    vwap: price,
    atrPct: clamp(Math.abs(m15) * 0.55 + Math.abs(h1) * 0.25 + 0.7, 0.55, 4.8),
    volumeZ: clamp((burst - 1) * 1.4, -2, 4),
    lastClose: price || null,
    extensionPct: m15 * 0.5,
    closeStrength: tape,
    priorHigh: price > 0 ? price * (1 + Math.max(-m15, 0) / 100) : null,
    priorLow: price > 0 ? price * (1 - Math.max(m15, 0) / 100) : null,
    barsAboveEma9: h1 > 0.2 ? 3 : 0,
    barsBelowEma9: h1 < -0.2 ? 3 : 0,
  };
}

/**
 * Candle structure wins when it has a setup. A quiet 5m chart must not hide a 15m tape that already agrees.
 */
export function entrySignals(
  token: TokenCandidate,
  tech: TechnicalSnapshot | null,
  researchScore: number | null,
  allowShorts: boolean,
  ctx: SignalContext | MarketRegime["stance"] = "mixed",
): Signal[] {
  if (tech) {
    const structured = buildSignals(token, tech, researchScore, allowShorts, ctx);
    if (structured.length) {
      // A 4-hour long must not hide the 15m short, or the red-tape filter drops the only signal.
      if (structured.every((signal) => signal.side === "long")) {
        const short = buildFlowSignals(token, researchScore, allowShorts, ctx).find((signal) => signal.side === "short");
        if (short) return [short];
      }
      return structured;
    }
  }
  return buildFlowSignals(token, researchScore, allowShorts, ctx);
}

/**
 * Solana entries come only from candle structure on the 4-hour decision chart.
 * The 15m pool-flow setups traded noise: in a 120-day replay they made 30+ round trips a day
 * and lost the book to fees. A missing 4-hour chart means no entry, not a 5m guess.
 */
export function solanaEntrySignals(
  token: TokenCandidate,
  decision: TechnicalSnapshot | null,
  researchScore: number | null,
  allowShorts: boolean,
  ctx: SignalContext | MarketRegime["stance"] = "mixed",
  band: AtrBand = FOUR_HOUR_ATR,
): Signal[] {
  return candleSetups(token, decision, researchScore, allowShorts, ctx, band).slice(0, 1);
}

/** Every long and short setup on one chart, best first, before any higher-frame check. */
export function candleSetups(
  token: TokenCandidate,
  tech: TechnicalSnapshot | null,
  researchScore: number | null,
  allowShorts: boolean,
  ctx: SignalContext | MarketRegime["stance"] = "mixed",
  band: AtrBand = FOUR_HOUR_ATR,
): Signal[] {
  if (!tech) return [];
  const found = buildSignals(token, tech, researchScore, allowShorts, ctx, band);
  if (!allowShorts) return found;
  const shorts = structuredShorts(token, tech, researchScore, ctx, band);
  return [...found, ...shorts].sort((a, b) => b.confidence - a.confidence);
}

/**
 * The same candle setups as the longs, turned over.
 * A breakdown is a breakout through the prior low. A reject is a reclaim from overbought.
 * A falling watchlist name and a VWAP reject match the continuation and the VWAP pullback.
 */
function structuredShorts(
  token: TokenCandidate,
  tech: TechnicalSnapshot,
  researchScore: number | null,
  ctx: SignalContext | MarketRegime["stance"],
  band: AtrBand = FOUR_HOUR_ATR,
): Signal[] {
  const stance = typeof ctx === "string" ? ctx : ctx.stance;
  const fearGreed = typeof ctx === "string" ? null : ctx.fearGreed;
  const solChange = typeof ctx === "string" ? 0 : ctx.solChange;
  if (!tech.lastClose || !tech.rsi14 || !tech.ema9 || !tech.ema21 || !tech.atrPct) return [];
  if (!atrTradeable(tech.atrPct, band)) return [];
  const price = tech.lastClose;
  const atr = Math.max(tech.atrPct, 0.6);
  const volZ = tech.volumeZ ?? 0;
  const ext = tech.extensionPct ?? 0;
  const h15 = token.flows.m15.priceChangePct;
  const h30 = token.flows.m30.priceChangePct;
  const h1 = token.flows.h1.priceChangePct;
  const tape = buyShare(token.flows.m15.buys, token.flows.m15.sells);
  const closeWeak = (tech.closeStrength ?? 1) <= 0.42;
  const brokeDown = tech.priorLow !== null && price <= tech.priorLow;
  const barsBelow = tech.barsBelowEma9 ?? 0;
  const signals: Signal[] = [];
  const base = {
    mint: token.mint,
    symbol: token.symbol,
    poolAddress: token.poolAddress,
    sector: token.sector,
    price,
    researchScore,
    createdAt: new Date().toISOString(),
  };
  const fearfulMemes = token.sector === "Meme" && fearGreed !== null && fearGreed <= 25;
  const solRip = solChange > 2.8;
  const trendDown = tech.ema9 < tech.ema21 && h1 < 1.5 && barsBelow >= 2;
  const notPanic = tech.rsi14 > 30 && ext > -4.8 && volZ < 5.2;
  const allowBreakdown =
    !fearfulMemes &&
    !(solRip && !token.watchlist) &&
    (stance !== "risk-on" || (token.watchlist && (researchScore ?? 0) >= 70));

  if (allowBreakdown && trendDown && notPanic && brokeDown && closeWeak && volZ > 1.05 && h15 < -0.35 && tech.rsi14 < 48 && tape <= 0.47) {
    const rr = withMinRR(clamp(atr * 1.25, 0.8, 3.6), clamp(atr * 2.15, 1.4, 6.8));
    signals.push({
      ...base,
      id: id("sig"),
      side: "short",
      reason: "breakout",
      confidence: clamp(60 + volZ * 5 + (researchScore ? (researchScore - 50) * 0.22 : 0) + (token.watchlist ? 3 : 0), 52, 93),
      ...rr,
      thesis: `${token.symbol} closed under the prior 12-bar low with EMA9<EMA21, RSI ${tech.rsi14.toFixed(0)}, buy share ${(tape * 100).toFixed(0)}%. Structure breakdown — the same setup as a breakout, turned over.`,
    });
  }

  const notRocket = h1 < 7 && h30 < 14;
  // The long reclaim fires under RSI 33, which is rare. A 4-hour RSI of 67 is common on this book
  // and those shorts lost the replay, so the short waits for a real extreme, the same RSI 78 line as a climax fade.
  if (tech.rsi14 > 78 && volZ > 0.35 && ext > -0.8 && notRocket && h15 < 0 && tape <= 0.52 && (tech.closeStrength ?? 1) <= 0.55) {
    const rr = withMinRR(clamp(atr * 1.15, 0.7, 3.2), clamp(atr * 2.0, 1.3, 5.8));
    signals.push({
      ...base,
      id: id("sig"),
      side: "short",
      reason: "reclaim",
      confidence: clamp(58 + (tech.rsi14 - 78) + (researchScore ? (researchScore - 45) * 0.15 : 0), 52, 88),
      ...rr,
      thesis: `${token.symbol} RSI ${tech.rsi14.toFixed(0)} with a weak close and no 1h rip. Mean-reversion short, the mirror of a reclaim.`,
    });
  }

  const underHigh = tech.priorHigh !== null && price <= tech.priorHigh;
  // A long continuation accepts a flat-to-up average or two closes above EMA9.
  // The short needs both: the average is not rising, and two closes are under EMA9.
  // One dip under the average was shorting every watchlist name.
  const flatToDown = tech.ema9 <= tech.ema21 * 1.002 && barsBelow >= 2;
  if (
    signals.length === 0 &&
    token.watchlist &&
    stance !== "risk-on" &&
    !solRip &&
    flatToDown &&
    underHigh &&
    tech.rsi14 >= 34 &&
    tech.rsi14 <= 54 &&
    ext > -3.2 &&
    (tech.closeStrength ?? 1) <= 0.42 &&
    tape <= 0.47 &&
    h15 < -0.35 &&
    h1 < 0.5 &&
    volZ > 1.05
  ) {
    const rr = withMinRR(clamp(atr * 1.05, 0.7, 2.8), clamp(atr * 1.9, 1.2, 5.2));
    signals.push({
      ...base,
      id: id("sig"),
      side: "short",
      reason: "reclaim",
      confidence: clamp(64 + (50 - tech.rsi14) * 0.25, 60, 84),
      ...rr,
      thesis: `${token.symbol} is a liquid watchlist name failing its range with RSI ${tech.rsi14.toFixed(0)} and the hour offered. Small continuation short.`,
    });
  }

  const nearVwap =
    tech.vwap !== null && price >= tech.vwap * 0.996 && price <= tech.vwap * 1.008 && tech.rsi14 >= 42 && tech.rsi14 <= 54;
  if (!solRip && trendDown && nearVwap && volZ > 0.2 && volZ < 4 && tape <= 0.49 && stance !== "risk-on") {
    const rr = withMinRR(clamp(atr * 1.1, 0.7, 3.0), clamp(atr * 1.95, 1.25, 5.4));
    signals.push({
      ...base,
      id: id("sig"),
      side: "short",
      reason: "reclaim",
      confidence: clamp(59 + volZ * 3.5 + (researchScore ? (researchScore - 50) * 0.16 : 0), 54, 86),
      ...rr,
      thesis: `${token.symbol} is rejecting VWAP with a live 4-hour downtrend. Pullback short — the mirror of a VWAP buy.`,
    });
  }

  return signals.filter((s) => rewardToRisk(s.stopPct, s.targetPct) >= 1.6);
}

/** Trade the pool tape the desk already loaded. No candle request. */
export function buildFlowSignals(
  token: TokenCandidate,
  researchScore: number | null,
  allowShorts: boolean,
  ctx: SignalContext | MarketRegime["stance"] = "mixed",
): Signal[] {
  const stance = typeof ctx === "string" ? ctx : ctx.stance;
  const fearGreed = typeof ctx === "string" ? null : ctx.fearGreed;
  const solChange = typeof ctx === "string" ? 0 : ctx.solChange;
  const price = token.priceUsd;
  if (!(price > 0)) return [];

  const h1 = token.flows.h1.priceChangePct;
  const m15 = token.flows.m15.priceChangePct;
  const m5 = token.flows.m5.priceChangePct;
  const tape = buyShare(token.flows.m15.buys, token.flows.m15.sells);
  const defensive = stance === "defensive";
  const solDump = solChange < -4.5;
  // A down 15m can still print about as many buys as sells. A buy spike is not a short.
  const sellHeavy = tape <= 0.62;
  const falling =
    token.watchlist &&
    m15 <= -0.15 &&
    m15 > -8 &&
    m5 < 0 &&
    h1 > -6 &&
    h1 < 4 &&
    sellHeavy;
  if (allowShorts && solOnlyShort(token) && !defensive && falling) {
    const stopPct = clamp(1.35, 1.2, 2.6);
    const rr = withMinRR(stopPct, stopPct * 1.8);
    const confidence = clamp(
      60 + Math.min(Math.abs(m15), 6) * 2 + (tape < 0.45 ? 4 : 0) + (researchScore !== null ? (researchScore - 55) * 0.1 : 0),
      58,
      88,
    );
    const short: Signal = {
      id: id("sig"),
      mint: token.mint,
      symbol: token.symbol,
      poolAddress: token.poolAddress,
      sector: token.sector,
      price,
      researchScore,
      createdAt: new Date().toISOString(),
      side: "short",
      reason: "fade",
      confidence,
      ...rr,
      thesis: `${token.symbol} 5m and 15m are falling — 15m ${m15.toFixed(2)}%, 1h ${h1.toFixed(2)}%, buy share ${(tape * 100).toFixed(0)}%. Short the drop.`,
    };
    return rewardToRisk(short.stopPct, short.targetPct) >= 1.6 ? [short] : [];
  }
  if (h1 <= -6 || m15 <= -0.25 || m5 <= -1.2 || solDump) return [];
  if (
    token.sector === "Meme" &&
    !token.watchlist &&
    (defensive || stance !== "risk-on" || (fearGreed !== null && fearGreed >= 75))
  ) {
    return [];
  }
  if (!token.watchlist && (defensive || token.sector === "Unknown")) return [];

  // A clearly rising watchlist name can print more sells than buys and still be the long.
  const rising =
    token.watchlist && m5 > 0 && m15 >= 0.4 && m15 < 8 && h1 > -0.5 && h1 < 8 && tape >= 0.3;
  const aligned =
    token.watchlist &&
    m15 >= 0.05 &&
    m15 < (defensive ? 5 : 6) &&
    m5 > -0.5 &&
    h1 > -1.5 &&
    h1 < (defensive ? 6 : 8) &&
    tape >= (defensive ? 0.48 : 0.45);
  const impulse =
    !defensive &&
    token.sector !== "Meme" &&
    m15 > 0.7 &&
    m5 > 0.05 &&
    h1 > 0 &&
    h1 < 10 &&
    tape >= 0.53;
  // A green 15m watchlist name is a long. Buy-share still has to be real, not a one-sided print.
  const greenLong =
    token.watchlist && m15 >= 0.1 && m15 < 8 && m5 > -0.2 && h1 > -2 && h1 < 10 && tape >= 0.32;
  // Flat 15m still takes 5x or 10x when the 5m is not red and the pool actually printed.
  const printed = token.flows.m5.buys + token.flows.m5.sells > 0;
  const flatLong =
    token.watchlist && printed && m15 > -0.25 && m15 < 8 && m5 > 0 && h1 > -3 && h1 < 12 && tape >= 0.32;
  if (!aligned && !impulse && !rising && !greenLong && !flatLong) return [];

  const stopPct = clamp(1.25 + (defensive ? 0.15 : 0), 1.2, 2.6);
  const rr = withMinRR(stopPct, stopPct * 1.8);
  const confidence = clamp(
    58 +
      (token.watchlist ? 4 : 0) +
      (m15 > 0.15 ? 6 : 0) +
      (m5 > 0 ? 4 : 0) +
      (h1 > 0 ? 4 : 0) +
      (tape - 0.5) * 18 +
      (researchScore !== null ? (researchScore - 55) * 0.1 : 0),
    60,
    90,
  );
  const reason: Signal["reason"] = (impulse || rising) && m15 >= 1.2 ? "breakout" : "reclaim";
  const side: Signal["side"] = "long";
  return [
    {
      id: id("sig"),
      mint: token.mint,
      symbol: token.symbol,
      poolAddress: token.poolAddress,
      sector: token.sector,
      price,
      researchScore,
      createdAt: new Date().toISOString(),
      side,
      reason,
      confidence,
      ...rr,
      thesis: `${token.symbol} 5m/15m/1h agree on a ${stance} tape — 15m ${m15.toFixed(2)}%, 1h ${h1.toFixed(2)}%, buy share ${(tape * 100).toFixed(0)}%. One ticket, sized from the wallet.`,
    },
  ].filter((s) => rewardToRisk(s.stopPct, s.targetPct) >= 1.6);
}
