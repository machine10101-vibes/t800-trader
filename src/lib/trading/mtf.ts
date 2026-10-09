import { sameMint } from "@/lib/chain";
import {
  confirmLogicFrames,
  DEFAULT_LOGIC_FRAMES,
  entryLogicFrame,
  normalizeLogicFrames,
} from "@/lib/deskSettings";
import { analyzeChart, frameBias, type Bias } from "@/lib/market/analysis";
import { closedCandles, FRAME_LABEL, FRAME_SECONDS, MIN_FOUR_HOUR_BARS, MIN_FRAME_BARS, type Frame } from "@/lib/market/frames";
import { SOL_MINT } from "@/lib/market/universe";
import type { BotConfig, Candle, MarketRegime, Signal, TechnicalSnapshot, TokenCandidate } from "@/lib/types";
import { candleSetups, FOUR_HOUR_ATR, setupAtrBand, snapshotTechnical, type SignalContext } from "./signals";

export interface FrameSet {
  m5?: Candle[] | null;
  m15: Candle[] | null;
  h1: Candle[] | null;
  h4: Candle[] | null;
}

export interface BackCheck {
  ok: boolean;
  why: string;
}

const MIN_BARS = MIN_FRAME_BARS;

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

function missingLabel(frame: Frame): NonNullable<FrameDecision["missing"]> {
  return FRAME_LABEL[frame] as NonNullable<FrameDecision["missing"]>;
}

function candlesFor(frames: FrameSet, frame: Frame): Candle[] | null {
  if (frame === "5m") return frames.m5 ?? null;
  if (frame === "15m") return frames.m15;
  if (frame === "1h") return frames.h1;
  return frames.h4;
}

function closedFor(frames: FrameSet, frame: Frame): Candle[] | null {
  const raw = candlesFor(frames, frame);
  return raw ? closedCandles(raw, FRAME_SECONDS[frame]) : null;
}

function enoughClosed(frame: Frame, rows: Candle[] | null): boolean {
  if (!rows) return false;
  return frame === "4h" ? rows.length >= MIN_FOUR_HOUR_BARS : rows.length >= MIN_BARS;
}

/**
 * A 15-minute trade needs the higher frames on its side: neither the 1-hour nor the 4-hour
 * may point the other way, and at least one of them has to agree. Two ranges is no edge.
 */
export function backCheck(side: Signal["side"], h1: Bias, h4: Bias): BackCheck {
  return confirmCheck(side, [
    { frame: "1h", bias: h1 },
    { frame: "4h", bias: h4 },
  ]);
}

export function confirmCheck(side: Signal["side"], confirms: { frame: Frame; bias: Bias }[]): BackCheck {
  if (!confirms.length) return { ok: true, why: "no higher chart is on" };
  const against = side === "long" ? "down" : "up";
  const with_ = side === "long" ? "up" : "down";
  for (const row of confirms) {
    if (row.bias === against) return { ok: false, why: `the ${FRAME_LABEL[row.frame]} trend is ${against}` };
  }
  if (!confirms.some((row) => row.bias === with_)) {
    if (confirms.length === 1) return { ok: false, why: `the ${FRAME_LABEL[confirms[0]!.frame]} chart is ranging` };
    const names = confirms.map((row) => FRAME_LABEL[row.frame]);
    const last = names[names.length - 1];
    const head = names.slice(0, -1).join(", ");
    return { ok: false, why: `the ${head} and ${last} charts are both ranging` };
  }
  return { ok: true, why: confirms.map((row) => `${FRAME_LABEL[row.frame]} ${biasWord(row.bias)}`).join(", ") };
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
  missing: "5-minute" | "15-minute" | "1-hour" | "4-hour" | null;
}

function frameBiasOrRange(rows: Candle[], frame: Frame): Bias {
  const ready = frame === "4h" ? rows.length >= MIN_BARS : true;
  if (!ready) return "range";
  return frameBias(rows) ?? "range";
}

/**
 * Entries come from the shortest chart that is on. Longer charts that stay on
 * must not fight the trade, and at least one of them has to agree.
 */
export function logicEntrySignals(
  token: TokenCandidate,
  frames: FrameSet,
  researchScore: number | null,
  allowShorts: boolean,
  ctx: SignalContext | MarketRegime["stance"] = "mixed",
  logicFrames: readonly Frame[] = DEFAULT_LOGIC_FRAMES,
): FrameDecision {
  const enabled = normalizeLogicFrames(logicFrames);
  const entry = entryLogicFrame(enabled);
  const confirms = confirmLogicFrames(enabled);
  if (entry === "4h" && !confirms.length) return fourHourEntrySignals(token, frames, researchScore, allowShorts, ctx);

  const entryRows = closedFor(frames, entry);
  if (!enoughClosed(entry, entryRows)) return { signals: [], pass: null, missing: missingLabel(entry) };
  for (const frame of confirms) {
    if (!enoughClosed(frame, closedFor(frames, frame))) return { signals: [], pass: null, missing: missingLabel(frame) };
  }

  const rows = entryRows!;
  if (entry === "4h" && rows.length < MIN_BARS) {
    return {
      signals: [],
      pass: `${token.symbol}: 4-hour chart is in, no solid setup yet (need more closed bars)`,
      missing: null,
    };
  }

  const tech = snapshotTechnical(rows.slice(-180));
  const found = candleSetups(token, tech, researchScore, allowShorts, ctx, setupAtrBand(token, entry));
  const entryName = FRAME_LABEL[entry];
  if (!found.length) return { signals: [], pass: `${token.symbol}: ${entryName} chart is in, no setup yet (${setupGap(tech)})`, missing: null };

  const confirmReads = confirms.map((frame) => ({
    frame,
    rows: closedFor(frames, frame)!,
    bias: frameBiasOrRange(closedFor(frames, frame)!, frame),
  }));
  const kept: Signal[] = [];
  let pass: string | null = null;
  for (const signal of found) {
    const check = confirmCheck(
      signal.side,
      confirmReads.map((row) => ({ frame: row.frame, bias: row.bias })),
    );
    if (!check.ok) {
      pass ??= `${token.symbol}: ${entryName} ${signal.side} ${signal.reason}, but ${check.why}, so it waits`;
      continue;
    }
    const four = confirmReads.find((row) => row.frame === "4h");
    const wall = four && four.rows.length >= MIN_BARS ? levelBlock(signal.side, signal.price, four.rows, tech.atrPct ?? 0) : null;
    if (wall) {
      pass ??= `${token.symbol}: ${entryName} ${signal.side} ${signal.reason}, but ${wall}, so it waits`;
      continue;
    }
    kept.push({
      ...signal,
      setupFrame: entry,
      thesis: confirms.length
        ? `${entryName} ${signal.side} ${signal.reason}. Back-check passed: ${check.why}. ${signal.thesis}`
        : `${entryName} ${signal.side} ${signal.reason}. ${signal.thesis}`,
    });
  }
  return kept.length ? { signals: kept.slice(0, 1), pass: null, missing: null } : { signals: [], pass, missing: null };
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
  return logicEntrySignals(token, frames, researchScore, allowShorts, ctx, DEFAULT_LOGIC_FRAMES);
}

function isSolName(token: Pick<TokenCandidate, "symbol" | "mint">): boolean {
  return token.symbol === "SOL" || token.mint === SOL_MINT || sameMint(token.mint, SOL_MINT);
}

/**
 * A solid 4-hour structure setup. Needs a full EMA window, not a thin new-pool tape.
 * Used when SOL margin waits for the 4-hour chart instead of a 15-minute continuation.
 */
export function fourHourEntrySignals(
  token: TokenCandidate,
  frames: FrameSet,
  researchScore: number | null,
  allowShorts: boolean,
  ctx: SignalContext | MarketRegime["stance"] = "mixed",
): FrameDecision {
  const h4 = frames.h4 ? closedCandles(frames.h4, FRAME_SECONDS["4h"]) : null;
  if (!h4 || h4.length < MIN_FOUR_HOUR_BARS) return { signals: [], pass: null, missing: "4-hour" };
  if (h4.length < MIN_BARS) {
    return {
      signals: [],
      pass: `${token.symbol}: 4-hour chart is in, no solid setup yet (need more closed bars)`,
      missing: null,
    };
  }
  const tech = snapshotTechnical(h4.slice(-180));
  const found = candleSetups(token, tech, researchScore, allowShorts, ctx, FOUR_HOUR_ATR);
  if (!found.length) {
    return { signals: [], pass: `${token.symbol}: 4-hour chart is in, no solid setup yet (${setupGap(tech)})`, missing: null };
  }
  return {
    signals: found.slice(0, 1).map((signal) => ({
      ...signal,
      setupFrame: "4h" as const,
      thesis: `4-hour ${signal.side} ${signal.reason}. Solid 4-hour structure. ${signal.thesis}`,
    })),
    pass: null,
    missing: null,
  };
}

export interface DeskEntryOpts {
  mode: BotConfig["solTradeMode"];
  marginOnFourHour: boolean;
  logicFrames?: readonly Frame[];
}

/**
 * Spot stays on the selected logic charts. Margin-only skips every name but SOL.
 * When margin waits on the 4-hour chart, SOL uses that structure setup if 4-hour is on.
 * Both + 4-hour gate keeps a shorter-frame fill as spot and prefers a 4-hour SOL margin fill when it is there.
 */
export function deskEntrySignals(
  token: TokenCandidate,
  frames: FrameSet,
  researchScore: number | null,
  allowShorts: boolean,
  ctx: SignalContext | MarketRegime["stance"] = "mixed",
  opts: DeskEntryOpts = { mode: "spot", marginOnFourHour: false },
): FrameDecision {
  const logicFrames = normalizeLogicFrames(opts.logicFrames);
  const fourOn = logicFrames.includes("4h");
  const sol = isSolName(token);
  if (opts.mode === "margin" && !sol) {
    return { signals: [], pass: `${token.symbol}: margin mode only trades SOL perps`, missing: null };
  }
  if (opts.mode === "margin" && opts.marginOnFourHour && fourOn) {
    return fourHourEntrySignals(token, frames, researchScore, allowShorts, ctx);
  }
  const primary = logicEntrySignals(token, frames, researchScore, allowShorts, ctx, logicFrames);
  const wantFourHour = (opts.mode === "margin" || opts.mode === "both") && opts.marginOnFourHour && fourOn && sol;
  if (!wantFourHour) return primary;
  const four = fourHourEntrySignals(token, frames, researchScore, allowShorts, ctx);
  if (four.signals.length) return four;
  if (primary.signals.length) return primary;
  if (primary.missing) return primary;
  return { signals: [], pass: primary.pass ?? four.pass, missing: primary.missing ?? four.missing };
}
