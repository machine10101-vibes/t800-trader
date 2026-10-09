import { FRAME_LABEL, FRAMES, type Frame } from "@/lib/market/frames";
import type { BotConfig } from "@/lib/types";
import { normalizeMultipliers } from "@/lib/trading/leverage";

/** USDC loaded onto the trading key when the bot is armed. */
export const ARM_FUNDS_USD = [25, 50, 150] as const;
export type ArmFundsUsd = (typeof ARM_FUNDS_USD)[number];
export const DEFAULT_ARM_FUNDS_USD: ArmFundsUsd = 50;

/** Dollars one buy spends. Never larger than the armed bankroll. */
export const BUY_SIZE_USD = [5, 10, 25, 50] as const;
export const DEFAULT_BUY_SIZE_USD = 10;

export function normalizeArmFundsUsd(value: unknown): ArmFundsUsd {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return ARM_FUNDS_USD.includes(n as ArmFundsUsd) ? (n as ArmFundsUsd) : DEFAULT_ARM_FUNDS_USD;
}

export function normalizeBuySizeUsd(value: unknown, armFundsUsd: number = DEFAULT_ARM_FUNDS_USD): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  const fallback = Math.min(DEFAULT_BUY_SIZE_USD, armFundsUsd);
  const raw = Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.min(armFundsUsd, Math.max(5, raw));
}

export const SOL_TRADE_MODES = ["spot", "margin", "both"] as const;
export type SolTradeMode = (typeof SOL_TRADE_MODES)[number];
export const DEFAULT_SOL_TRADE_MODE: SolTradeMode = "spot";

export function normalizeSolTradeMode(value: unknown, multipliers: readonly number[] = []): SolTradeMode {
  if (value === "spot" || value === "margin" || value === "both") return value;
  return multipliers.length ? "both" : DEFAULT_SOL_TRADE_MODE;
}

/**
 * A saved book from before this setting existed did not store a mode.
 * Multipliers that are on mean they wanted levered SOL alongside spot.
 */
export function resolveSolTradeMode(input?: Partial<BotConfig> | null, multipliers: readonly number[] = []): SolTradeMode {
  if (input && "solTradeMode" in input) return normalizeSolTradeMode(input.solTradeMode, multipliers);
  if (input && "multipliers" in input) return normalizeMultipliers(input.multipliers).length ? "both" : "spot";
  return DEFAULT_SOL_TRADE_MODE;
}

export function normalizeMarginOnFourHour(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

/** Older books that never stored this keep the current 15-minute entry plus 1-hour and 4-hour checks. */
export const DEFAULT_LOGIC_FRAMES: Frame[] = ["15m", "1h", "4h"];

export function isLogicFrame(value: unknown): value is Frame {
  return value === "5m" || value === "15m" || value === "1h" || value === "4h";
}

export function normalizeLogicFrames(value: unknown): Frame[] {
  if (!Array.isArray(value)) return [...DEFAULT_LOGIC_FRAMES];
  const on = new Set(value.filter(isLogicFrame));
  const next = FRAMES.filter((frame) => on.has(frame));
  return next.length ? next : [...DEFAULT_LOGIC_FRAMES];
}

/** Keep at least one chart on. Turning the last one off leaves it on. */
export function toggleLogicFrame(current: readonly Frame[], frame: Frame, on: boolean): Frame[] {
  const next = on ? [...current, frame] : current.filter((item) => item !== frame);
  const normalized = normalizeLogicFrames(next);
  if (!on && current.length === 1 && current[0] === frame) return [frame];
  return normalized;
}

export function entryLogicFrame(frames: readonly Frame[]): Frame {
  return normalizeLogicFrames(frames)[0] ?? "15m";
}

export function confirmLogicFrames(frames: readonly Frame[]): Frame[] {
  return normalizeLogicFrames(frames).slice(1);
}

export function logicFramesRule(frames: readonly Frame[]): string {
  const enabled = normalizeLogicFrames(frames);
  const entry = FRAME_LABEL[entryLogicFrame(enabled)];
  const confirm = confirmLogicFrames(enabled).map((frame) => FRAME_LABEL[frame]);
  if (!confirm.length) return `Finds its trades on the ${entry} chart.`;
  if (confirm.length === 1) {
    return `Finds its trades on the ${entry} chart, then checks the ${confirm[0]} chart. If that higher chart points the other way, it skips the trade.`;
  }
  const last = confirm[confirm.length - 1];
  const head = confirm.slice(0, -1).join(", ");
  return `Finds its trades on the ${entry} chart, then checks the ${head} and ${last} charts. If a higher chart that is on points the other way, it skips the trade.`;
}

export const CRONOS_QUOTES = ["usdc", "cro"] as const;
export type CronosQuote = (typeof CRONOS_QUOTES)[number];
export const DEFAULT_CRONOS_QUOTE: CronosQuote = "usdc";

/** Older Cronos books that never stored a quote stay on USDC. */
export function normalizeCronosQuote(value: unknown): CronosQuote {
  return value === "cro" || value === "usdc" ? value : DEFAULT_CRONOS_QUOTE;
}

/** Margin or both with an empty list still posts a SOL 5x or 10x. */
export function multipliersForMode(mode: SolTradeMode, multipliers: readonly number[]): number[] {
  if (mode === "spot") return [...multipliers];
  return multipliers.length ? [...multipliers] : [5, 10];
}

export function usdcToLoad(haveUsd: number, wantUsd: number, alreadyUsd = 0): number {
  const need = Math.max(0, wantUsd - Math.max(0, alreadyUsd));
  if (!(haveUsd > 0) || !(need > 0)) return 0;
  return Math.min(Math.round(haveUsd * 1e6) / 1e6, Math.round(need * 1e6) / 1e6);
}

/**
 * A desk refresh must not put an unsaved slider back to the saved policy.
 * Once the draft matches the save, the form follows the book again.
 */
export function nextSettingsDraft(draft: BotConfig, saved: BotConfig, editing: boolean): BotConfig {
  return editing ? draft : saved;
}

/** Max ticket is a dollar cap. 5 stays 5. Blank or junk keeps the previous cap. */
export function commitTicketCap(raw: string, fallback = 250): number {
  const text = String(raw).trim();
  const next = text ? Number(text) : Number.NaN;
  const basis = Number.isFinite(next) ? next : fallback;
  return Math.min(10_000, Math.max(5, basis));
}
