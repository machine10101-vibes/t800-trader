import type { Candle, Signal, TechnicalSnapshot, TokenCandidate } from "@/lib/types";
import { clamp, id, mean, stdev } from "@/lib/utils";

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
  return {
    rsi14: rsi(closes, 14),
    ema9: e9,
    ema21: e21,
    vwap: vw,
    atrPct: atrPct(candles, 14),
    volumeZ,
    lastClose: last,
    extensionPct,
  };
}

export function buildSignals(
  token: TokenCandidate,
  tech: TechnicalSnapshot,
  researchScore: number | null,
  allowShorts: boolean,
): Signal[] {
  if (!tech.lastClose || !tech.rsi14 || !tech.ema9 || !tech.ema21 || !tech.atrPct) return [];
  const price = tech.lastClose;
  const atr = Math.max(tech.atrPct, 0.6);
  const volZ = tech.volumeZ ?? 0;
  const ext = tech.extensionPct ?? 0;
  const h15 = token.flows.m15.priceChangePct;
  const h30 = token.flows.m30.priceChangePct;
  const h1 = token.flows.h1.priceChangePct;
  const signals: Signal[] = [];

  const base = {
    mint: token.mint,
    symbol: token.symbol,
    poolAddress: token.poolAddress,
    price,
    researchScore,
    createdAt: new Date().toISOString(),
  };

  const trendUp = tech.ema9 > tech.ema21 && h1 > -1.5;
  const notEuphoric = tech.rsi14 < 72 && ext < 5.5;
  if (trendUp && notEuphoric && volZ > 1.15 && h15 > 0.4 && tech.rsi14 > 50) {
    signals.push({
      ...base,
      id: id("sig"),
      side: "long",
      reason: "breakout",
      confidence: clamp(58 + volZ * 6 + (researchScore ? (researchScore - 50) * 0.2 : 0), 50, 92),
      stopPct: clamp(atr * 1.35, 0.8, 4.2),
      targetPct: clamp(atr * 2.2, 1.3, 7.5),
      thesis: `${token.symbol} 5m trend is up (EMA9>EMA21), RSI ${tech.rsi14.toFixed(0)}, volume z ${volZ.toFixed(1)}. Breakout scalp, not a bag-hold.`,
    });
  }

  if (tech.rsi14 < 34 && volZ > 0.2 && ext < 1 && h30 > -18) {
    signals.push({
      ...base,
      id: id("sig"),
      side: "long",
      reason: "reclaim",
      confidence: clamp(55 + (34 - tech.rsi14) + (researchScore ? (researchScore - 45) * 0.15 : 0), 50, 88),
      stopPct: clamp(atr * 1.2, 0.7, 3.8),
      targetPct: clamp(atr * 1.9, 1.1, 6.2),
      thesis: `${token.symbol} RSI ${tech.rsi14.toFixed(0)} on 5m with cooling extension. Mean-reversion long if liquidity holds.`,
    });
  }

  if (allowShorts && (h30 > 11 || h1 > 18) && tech.rsi14 > 76 && ext > 4.5) {
    signals.push({
      ...base,
      id: id("sig"),
      side: "short",
      reason: "fade",
      confidence: clamp(56 + Math.min(h30, 25) * 0.6, 52, 90),
      stopPct: clamp(atr * 1.5, 1.0, 5.0),
      targetPct: clamp(atr * 2.0, 1.4, 7.0),
      thesis: `${token.symbol} is extended (${h30.toFixed(1)}% / 30m, RSI ${tech.rsi14.toFixed(0)}). Fade the climax — time-boxed.`,
    });
  }

  return signals.sort((a, b) => b.confidence - a.confidence).slice(0, 1);
}
