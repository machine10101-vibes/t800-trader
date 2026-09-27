import type { BotConfig } from "@/lib/types";

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
