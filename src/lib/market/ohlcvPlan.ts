/** How often a pinned pool (SOL, Zebec, CRO) is re-read. */
export const CORE_POOL_MS = 12_000;
/** Popular names keep their pool longer so the candle calls have room. */
export const POPULAR_POOL_MS = 55_000;
/** A missed pool read waits before it spends another GeckoTerminal call. */
export const POOL_MISS_MS = 18_000;
/** Pinned 5-minute candles stay fresh enough for the book. */
export const CORE_CANDLE_MS = 20_000;
/** A popular chart can sit for a minute and a half. */
export const POPULAR_CANDLE_MS = 90_000;
/** After a 429 or an empty chart, leave that pool alone. */
export const CANDLE_COOL_MS = 40_000;

export interface MintSnap {
  at: number;
  ok: boolean;
}

/**
 * Core pools refresh on their own clock. Only a couple of popular names are
 * fetched on one pass, so eight books do not empty the rate limit at once.
 */
export function mintsToFetch(
  book: { mint: string; pinned: boolean }[],
  snaps: ReadonlyMap<string, MintSnap>,
  now: number,
  popularLimit = 1,
): string[] {
  const due = book.filter((token) => {
    const snap = snaps.get(token.mint);
    if (!snap) return true;
    const ttl = snap.ok ? (token.pinned ? CORE_POOL_MS : POPULAR_POOL_MS) : POOL_MISS_MS;
    return now - snap.at >= ttl;
  });
  const core = due.filter((token) => token.pinned).map((token) => token.mint);
  const popular = due.filter((token) => !token.pinned).slice(0, popularLimit).map((token) => token.mint);
  return [...core, ...popular];
}

/**
 * Candles already on screen, or cooling down after a miss, are not fetched again.
 * The first gaps in book order win, capped so one pass cannot stampede.
 */
export function poolsToCandle(
  pools: { address: string; pinned: boolean }[],
  freshAt: ReadonlyMap<string, number>,
  missedAt: ReadonlyMap<string, number>,
  now: number,
  limit = 2,
): string[] {
  const out: string[] = [];
  for (const pool of pools) {
    if (!pool.address) continue;
    const fresh = freshAt.get(pool.address);
    const freshMs = pool.pinned ? CORE_CANDLE_MS : POPULAR_CANDLE_MS;
    if (fresh !== undefined && now - fresh < freshMs) continue;
    const missed = missedAt.get(pool.address);
    if (missed !== undefined && now - missed < CANDLE_COOL_MS) continue;
    out.push(pool.address);
    if (out.length >= limit) break;
  }
  return out;
}
