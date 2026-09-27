/** How long a hand close keeps the scan from reopening that mint. */
export const REENTRY_MS = 3 * 60_000;

export function reentryHold(mint: string, now = Date.now()): { mint: string; until: string } {
  return { mint, until: new Date(now + REENTRY_MS).toISOString() };
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
