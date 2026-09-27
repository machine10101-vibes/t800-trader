import { classifySector, isStable, SOL_MINT, ZBCN_MINT, type WatchToken } from "@/lib/market/universe";

/** Jupiter's most-traded list. This is the popular section on the DEX. */
const POPULAR_URL = "https://lite-api.jup.ag/tokens/v2/toptraded/1h?limit=30";
const POPULAR_CACHE_MS = 60_000;
/** Names besides SOL and Zebec. Enough to cover the popular row without a pool request per mint on Solana. */
export const POPULAR_CAP = 6;
const MIN_LIQUIDITY_USD = 150_000;
const MIN_ORGANIC = 60;

export interface JupiterListedToken {
  id?: string;
  symbol?: string;
  name?: string;
  liquidity?: number;
  organicScore?: number;
}

let cache: { at: number; tokens: WatchToken[] } | null = null;

/**
 * Liquid names from Jupiter's most-traded hour, excluding stables and the pinned SOL and Zebec rows.
 * Dust and thin organic scores stay off the book.
 */
export function selectPopular(rows: JupiterListedToken[], coreMints: readonly string[] = [SOL_MINT, ZBCN_MINT]): WatchToken[] {
  const seen = new Set(coreMints);
  const out: WatchToken[] = [];
  for (const row of rows) {
    const mint = row.id?.trim() ?? "";
    const symbol = row.symbol?.trim().toUpperCase() ?? "";
    if (!mint || !symbol || seen.has(mint)) continue;
    if (isStable(symbol)) continue;
    if (!((row.liquidity ?? 0) >= MIN_LIQUIDITY_USD)) continue;
    if (!((row.organicScore ?? 0) >= MIN_ORGANIC)) continue;
    seen.add(mint);
    out.push({
      symbol,
      name: row.name?.trim() || symbol,
      mint,
      sector: classifySector(symbol, row.name?.trim() || symbol),
    });
    if (out.length >= POPULAR_CAP) break;
  }
  return out;
}

/** Last good Jupiter popular list. A failed read keeps that list instead of emptying the book. */
export async function loadJupiterPopular(): Promise<WatchToken[] | null> {
  if (cache && Date.now() - cache.at < POPULAR_CACHE_MS) return cache.tokens;
  try {
    const res = await fetch(POPULAR_URL, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) return cache?.tokens ?? null;
    const json = (await res.json()) as unknown;
    const tokens = selectPopular(Array.isArray(json) ? (json as JupiterListedToken[]) : []);
    cache = { at: Date.now(), tokens };
    return tokens;
  } catch {
    return cache?.tokens ?? null;
  }
}
