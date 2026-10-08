import type { Candle } from "@/lib/types";

export type Bias = "up" | "down" | "range";

export interface Pivot {
  index: number;
  price: number;
  kind: "high" | "low";
  /** Higher high, lower high, higher low, lower low against the previous pivot of the same kind. */
  label: "HH" | "LH" | "HL" | "LL" | null;
}

export interface Level {
  price: number;
  touches: number;
  kind: "support" | "resistance";
}

export interface Trendline {
  kind: "support" | "resistance";
  from: { index: number; price: number };
  to: { index: number; price: number };
  /** Where the line sits on the last bar. */
  now: number;
  rising: boolean;
}

export interface Fib {
  direction: "up" | "down";
  swingHigh: { index: number; price: number };
  swingLow: { index: number; price: number };
  levels: { ratio: number; price: number }[];
}

export interface CrossMark {
  index: number;
  price: number;
  dir: "bull" | "bear";
}

export interface ChartAnalysis {
  ema9: (number | null)[];
  ema21: (number | null)[];
  ema50: (number | null)[];
  vwap: (number | null)[];
  rsi: (number | null)[];
  pivots: Pivot[];
  supports: Level[];
  resistances: Level[];
  trendlines: Trendline[];
  fib: Fib | null;
  crosses: CrossMark[];
  structure: "higher highs and higher lows" | "lower highs and lower lows" | "mixed swings";
  bias: Bias;
  last: number;
  atr: number;
  rsiNow: number | null;
  notes: string[];
}

export function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = e;
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

export function rsiSeries(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length < period + 1) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function vwapSeries(candles: Candle[]): (number | null)[] {
  let pv = 0;
  let vol = 0;
  return candles.map((c) => {
    pv += ((c.high + c.low + c.close) / 3) * c.volume;
    vol += c.volume;
    return vol > 0 ? pv / vol : null;
  });
}

function atrAbs(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1].close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/** A swing point is the extreme of the `span` bars on each side. The last `span` bars cannot confirm one yet. */
export function findPivots(candles: Candle[], span = 3): Pivot[] {
  const raw: Omit<Pivot, "label">[] = [];
  for (let i = span; i < candles.length - span; i++) {
    const window = candles.slice(i - span, i + span + 1);
    const hi = candles[i].high;
    const lo = candles[i].low;
    // Strict on the left, ties allowed on the right, so a flat top marks once at its first bar.
    if (window.every((c, j) => j === span || (j < span ? c.high < hi : c.high <= hi))) raw.push({ index: i, price: hi, kind: "high" });
    if (window.every((c, j) => j === span || (j < span ? c.low > lo : c.low >= lo))) raw.push({ index: i, price: lo, kind: "low" });
  }
  let prevHigh: number | null = null;
  let prevLow: number | null = null;
  return raw.map((p) => {
    let label: Pivot["label"] = null;
    if (p.kind === "high") {
      if (prevHigh !== null) label = p.price > prevHigh ? "HH" : "LH";
      prevHigh = p.price;
    } else {
      if (prevLow !== null) label = p.price > prevLow ? "HL" : "LL";
      prevLow = p.price;
    }
    return { ...p, label };
  });
}

/** Pivots within a band of each other are one level. More touches make a stronger level. */
export function clusterLevels(pivots: Pivot[], last: number, band: number): { supports: Level[]; resistances: Level[] } {
  const groups: { sum: number; n: number }[] = [];
  for (const p of [...pivots].sort((a, b) => a.price - b.price)) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(p.price - g.sum / g.n) <= band) {
      g.sum += p.price;
      g.n += 1;
    } else {
      groups.push({ sum: p.price, n: 1 });
    }
  }
  const levels = groups.map((g) => ({ price: g.sum / g.n, touches: g.n }));
  const supports = levels
    .filter((l) => l.price < last)
    .sort((a, b) => b.price - a.price)
    .slice(0, 3)
    .map((l) => ({ ...l, kind: "support" as const }));
  const resistances = levels
    .filter((l) => l.price >= last)
    .sort((a, b) => a.price - b.price)
    .slice(0, 3)
    .map((l) => ({ ...l, kind: "resistance" as const }));
  return { supports, resistances };
}

function trendline(pivots: Pivot[], kind: "high" | "low", lastIndex: number): Trendline | null {
  const pts = pivots.filter((p) => p.kind === kind).slice(-2);
  if (pts.length < 2 || pts[1].index === pts[0].index) return null;
  const [a, b] = pts;
  const slope = (b.price - a.price) / (b.index - a.index);
  return {
    kind: kind === "high" ? "resistance" : "support",
    from: { index: a.index, price: a.price },
    to: { index: b.index, price: b.price },
    now: b.price + slope * (lastIndex - b.index),
    rising: slope > 0,
  };
}

function fibonacci(candles: Candle[]): Fib | null {
  if (candles.length < 20) return null;
  let hi = 0;
  let lo = 0;
  candles.forEach((c, i) => {
    if (c.high > candles[hi].high) hi = i;
    if (c.low < candles[lo].low) lo = i;
  });
  const high = candles[hi].high;
  const low = candles[lo].low;
  if (!(high > low)) return null;
  const direction = lo < hi ? "up" : "down";
  const ratios = [0.236, 0.382, 0.5, 0.618, 0.786];
  const levels = ratios.map((ratio) => ({
    ratio,
    price: direction === "up" ? high - (high - low) * ratio : low + (high - low) * ratio,
  }));
  return { direction, swingHigh: { index: hi, price: high }, swingLow: { index: lo, price: low }, levels };
}

function crossMarks(ema9: (number | null)[], ema21: (number | null)[], candles: Candle[]): CrossMark[] {
  const out: CrossMark[] = [];
  for (let i = 1; i < candles.length; i++) {
    const a0 = ema9[i - 1];
    const b0 = ema21[i - 1];
    const a1 = ema9[i];
    const b1 = ema21[i];
    if (a0 === null || b0 === null || a1 === null || b1 === null) continue;
    if (a0 <= b0 && a1 > b1) out.push({ index: i, price: candles[i].low, dir: "bull" });
    if (a0 >= b0 && a1 < b1) out.push({ index: i, price: candles[i].high, dir: "bear" });
  }
  return out.slice(-6);
}

function pf(v: number): string {
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (v >= 1) return v.toFixed(2);
  return v.toPrecision(4);
}

/**
 * The read the bot trades on and the chart draws: EMA stack, swing structure, horizontal levels,
 * trendlines through the last two swings, and a Fibonacci retracement of the range.
 */
export function analyzeChart(candles: Candle[]): ChartAnalysis {
  const closes = candles.map((c) => c.close);
  const last = closes[closes.length - 1] ?? 0;
  const ema9 = emaSeries(closes, 9);
  const ema21 = emaSeries(closes, 21);
  const ema50 = emaSeries(closes, 50);
  const rsi = rsiSeries(closes, 14);
  const atr = atrAbs(candles);
  const pivots = findPivots(candles);
  const band = Math.max(atr * 0.6, last * 0.004);
  const { supports, resistances } = clusterLevels(pivots, last, band);
  const lastIndex = candles.length - 1;
  const trendlines = [trendline(pivots, "low", lastIndex), trendline(pivots, "high", lastIndex)].filter(
    (line): line is Trendline => line !== null,
  );
  const highs = pivots.filter((p) => p.kind === "high").slice(-2);
  const lows = pivots.filter((p) => p.kind === "low").slice(-2);
  const hh = highs.length === 2 && highs[1].price > highs[0].price;
  const hl = lows.length === 2 && lows[1].price > lows[0].price;
  const lh = highs.length === 2 && highs[1].price < highs[0].price;
  const ll = lows.length === 2 && lows[1].price < lows[0].price;
  const structure: ChartAnalysis["structure"] = hh && hl ? "higher highs and higher lows" : lh && ll ? "lower highs and lower lows" : "mixed swings";
  const e9 = ema9[lastIndex] ?? null;
  const e21 = ema21[lastIndex] ?? null;
  const e50 = ema50[lastIndex] ?? null;
  let bias: Bias = "range";
  if (e9 !== null && e21 !== null) {
    const stackUp = e9 > e21 && last > e21 && (e50 === null || e21 >= e50 * 0.995);
    const stackDown = e9 < e21 && last < e21 && (e50 === null || e21 <= e50 * 1.005);
    if (stackUp && !(lh && ll)) bias = "up";
    else if (stackDown && !(hh && hl)) bias = "down";
  }
  const rsiNow = rsi[lastIndex] ?? null;
  const notes: string[] = [];
  if (e9 !== null && e21 !== null) {
    const order = e50 === null ? (e9 > e21 ? "EMA 9 over 21" : "EMA 9 under 21") : e9 > e21 && e21 > e50 ? "EMA 9 > 21 > 50" : e9 < e21 && e21 < e50 ? "EMA 9 < 21 < 50" : "EMAs tangled";
    notes.push(`Trend ${bias === "range" ? "is a range" : bias}: ${order}, ${structure}.`);
  }
  if (rsiNow !== null) {
    const zone = rsiNow >= 70 ? "overbought" : rsiNow <= 30 ? "oversold" : rsiNow >= 50 ? "above the midline" : "below the midline";
    notes.push(`RSI ${rsiNow.toFixed(0)}, ${zone}.`);
  }
  const sup = supports[0];
  const res = resistances[0];
  if (sup || res) {
    notes.push(
      [sup ? `Support ${pf(sup.price)} (${sup.touches} touch${sup.touches === 1 ? "" : "es"})` : null, res ? `resistance ${pf(res.price)} (${res.touches} touch${res.touches === 1 ? "" : "es"})` : null]
        .filter(Boolean)
        .join(", ") + ".",
    );
  }
  for (const line of trendlines) {
    const side = last >= line.now ? "above" : "below";
    notes.push(`Price is ${side} the ${line.rising ? "rising" : "falling"} ${line.kind} line at ${pf(line.now)}.`);
  }
  return { ema9, ema21, ema50, vwap: vwapSeries(candles), rsi, pivots, supports, resistances, trendlines, fib: fibonacci(candles), crosses: crossMarks(ema9, ema21, candles), structure, bias, last, atr, rsiNow, notes };
}

/** The higher-frame bias the bot uses for its back-check. Too few bars is no opinion. */
export function frameBias(candles: Candle[] | null | undefined): Bias | null {
  if (!candles || candles.length < 30) return null;
  return analyzeChart(candles.slice(-180)).bias;
}
