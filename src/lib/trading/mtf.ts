import { analyzeChart, frameBias, type Bias } from "@/lib/market/analysis";
import { closedCandles, FRAME_SECONDS } from "@/lib/market/frames";
import type { Candle, MarketRegime, Signal, TechnicalSnapshot, TokenCandidate } from "@/lib/types";
import { candleSetups, FIFTEEN_MIN_ATR, snapshotTechnical, type SignalContext } from "./signals";

export interface FrameSet {
  m15: Candle[] | null;
  h1: Candle[] | null;
  h4: Candle[] | null;
}

export interface BackCheck {
  ok: boolean;
  why: string;
}

const MIN_BARS = 30;
/** A new pool can have a 15-minute and 1-hour tape before thirty 4-hour bars exist. */
const MIN_FOUR_HOUR_BARS = 8;

function biasWord(bias: Bias): string {
  return bias === "range" ? "ranging" : bias;
}

function setupGap(tech: TechnicalSnapshot): string {
  const bits: string[] = [];
  if (tech.ema9 !== null && tech.ema21 !== null) bits.push(tech.ema9 >= tech.ema21 ? "EMA 9 over 21" : "EMA 9 under 21");
  if (tech.rsi14 !== null) bits.push(`RSI ${tech.rsi14.toFixed(0)}`);
  if ((tech.rsi14 ?? 50) >= 70) bits.push("overbought");
  if ((tech.rsi14 ?? 50) <= 30) bits.push("oversold");
  if ((tech.closeStrength ?? 0.5) < 0.4) bits.push("last closed bar was weak");
  return bits.join(", ") || "no breakout or reclaim";
}

/**
 * A 15-minute trade needs the higher frames on its side: neither the 1-hour nor the 4-hour
 * may point the other way, and at least one of them has to agree. Two ranges is no edge.
 */
export function backCheck(side: Signal["side"], h1: Bias, h4: Bias): BackCheck {
  const against = side === "long" ? "down" : "up";
  const with_ = side === "long" ? "up" : "down";
  if (h4 === against) return { ok: false, why: `the 4-hour trend is ${against}` };
  if (h1 === against) return { ok: false, why: `the 1-hour trend is ${against}` };
  if (h1 !== with_ && h4 !== with_) return { ok: false, why: "the 1-hour and 4-hour charts are both ranging" };
  return { ok: true, why: `1-hour ${biasWord(h1)}, 4-hour ${biasWord(h4)}` };
}

/** A level on the 4-hour chart inside one 15-minute ATR is the wall the trade would run into. */
export function levelBlock(side: Signal["side"], price: number, h4: Candle[], m15AtrPct: number): string | null {
  const read = analyzeChart(h4.slice(-180));
  const room = (price * Math.max(m15AtrPct, 0.15)) / 100;
  const levels = [...read.supports, ...read.resistances].map((level) => level.price);
  if (side === "long") {
    const wall = Math.min(...levels.filter((level) => level > price));
    if (Number.isFinite(wall) && wall - price < room) return `it is pressing into 4-hour resistance at ${wall.toPrecision(5)}`;
  } else {
    const floor = Math.max(...levels.filter((level) => level < price));
    if (Number.isFinite(floor) && price - floor < room) return `it is sitting on 4-hour support at ${floor.toPrecision(5)}`;
  }
  return null;
}

export interface FrameDecision {
  signals: Signal[];
  /** Why there is no ticket, written for the bot log. Empty when a signal passed. */
  pass: string | null;
  missing: "15-minute" | "1-hour" | "4-hour" | null;
}

/**
 * Entries come from the 15-minute chart. Each one is then checked against the 1-hour and 4-hour
 * charts: the trend on both, and the nearest 4-hour level in the trade's way.
 */
export function frameEntrySignals(
  token: TokenCandidate,
  frames: FrameSet,
  researchScore: number | null,
  allowShorts: boolean,
  ctx: SignalContext | MarketRegime["stance"] = "mixed",
): FrameDecision {
  const m15 = frames.m15 ? closedCandles(frames.m15, FRAME_SECONDS["15m"]) : null;
  const h1 = frames.h1 ? closedCandles(frames.h1, FRAME_SECONDS["1h"]) : null;
  const h4 = frames.h4 ? closedCandles(frames.h4, FRAME_SECONDS["4h"]) : null;
  if (!m15 || m15.length < MIN_BARS) return { signals: [], pass: null, missing: "15-minute" };
  if (!h1 || h1.length < MIN_BARS) return { signals: [], pass: null, missing: "1-hour" };
  if (!h4 || h4.length < MIN_FOUR_HOUR_BARS) return { signals: [], pass: null, missing: "4-hour" };
  const tech = snapshotTechnical(m15.slice(-180));
  const found = candleSetups(token, tech, researchScore, allowShorts, ctx, FIFTEEN_MIN_ATR);
  if (!found.length) return { signals: [], pass: `${token.symbol}: 15-minute chart is in, no setup yet (${setupGap(tech)})`, missing: null };
  const hourBias = frameBias(h1) ?? "range";
  const fourReady = h4.length >= MIN_BARS;
  const fourBias = fourReady ? (frameBias(h4) ?? "range") : "range";
  const kept: Signal[] = [];
  let pass: string | null = null;
  for (const signal of found) {
    const check = backCheck(signal.side, hourBias, fourBias);
    if (!check.ok) {
      pass ??= `${token.symbol}: 15-minute ${signal.side} ${signal.reason}, but ${check.why}, so it waits`;
      continue;
    }
    const wall = fourReady ? levelBlock(signal.side, signal.price, h4, tech.atrPct ?? 0) : null;
    if (wall) {
      pass ??= `${token.symbol}: 15-minute ${signal.side} ${signal.reason}, but ${wall}, so it waits`;
      continue;
    }
    kept.push({
      ...signal,
      thesis: `15-minute ${signal.side} ${signal.reason}. Back-check passed: ${check.why}. ${signal.thesis}`,
    });
  }
  return kept.length ? { signals: kept.slice(0, 1), pass: null, missing: null } : { signals: [], pass, missing: null };
}
