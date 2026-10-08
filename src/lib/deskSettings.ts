import type { BotConfig } from "@/lib/types";

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
