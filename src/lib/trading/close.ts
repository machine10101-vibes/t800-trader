import type { AppState } from "@/lib/types";
import { closePosition, pushEquity } from "./paper";

/** How long a hand close, stop, or target keeps the scan from opening another trade. */
export const REENTRY_MS = 3 * 60_000;

export type ReentryWhy = "hand" | "stop" | "target";

export function reentryHold(
  mint: string,
  now = Date.now(),
  why: ReentryWhy = "hand",
): { mint: string; until: string; why: ReentryWhy } {
  return { mint, until: new Date(now + REENTRY_MS).toISOString(), why };
}

/** A preset stop or target fill is an exit. The same scan must not open a replacement trade. */
export function bracketFillBlocksEntry(reason: string | undefined): boolean {
  return reason === "stop" || reason === "target";
}

export function bracketQuietUntil(now = Date.now()): string {
  return new Date(now + REENTRY_MS).toISOString();
}

export function bracketQuiet(until: string | null | undefined, now = Date.now()): boolean {
  if (!until) return false;
  const t = Date.parse(until);
  return Number.isFinite(t) && t > now;
}

export function reentryNote(symbol: string, why: string | undefined): string {
  if (why === "target") return `${symbol}: target was preset — no new trade`;
  if (why === "stop") return `${symbol}: stop was preset — no new trade`;
  return `${symbol}: closed by hand — the next ticket waits a few minutes`;
}

/** True while a hand close is still blocking a new ticket in this mint. */
export function reentryBlocked(
  skip: { mint: string; until: string } | null | undefined,
  mint: string,
  now = Date.now(),
): boolean {
  if (!skip || skip.mint !== mint) return false;
  const until = Date.parse(skip.until);
  return Number.isFinite(until) && until > now;
}

/** Chain close found nothing left to sell, so the book row can come off. */
export function isAlreadyFlat(message: string): boolean {
  return message.startsWith("ALREADY_FLAT");
}

/** Exit one named ticket. Flatten / disarm must not go through here. */
export function applyHandClose(
  state: AppState,
  positionId: string,
  price: number,
  signature?: string,
  note?: string,
): AppState {
  const pos = state.positions.find((p) => p.id === positionId);
  if (!pos) return state;
  const closed = pushEquity(closePosition(state, pos.id, price, "manual", signature));
  return {
    ...closed,
    bot: {
      ...closed.bot,
      lastNote: note ?? `Closed ${pos.symbol} by hand`,
      skipReentry: reentryHold(pos.mint),
    },
  };
}
