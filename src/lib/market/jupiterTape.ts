import type { FlowWindow, Timeframe, TokenCandidate } from "@/lib/types";
import { fetchJson, num } from "@/lib/utils";
import { jupiterChartUrl, parseJupiterCandles } from "./jupiterChart";

const SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search?query=";
const TAPE_MS = 20_000;

/** A gecko window with no trades and no move is not a tape. Jupiter's token stats replace it. */
export function windowIsQuiet(window: FlowWindow): boolean {
  return window.buys + window.sells === 0 && window.volumeUsd === 0 && window.priceChangePct === 0;
}

export interface JupiterTape {
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  windows: Partial<Record<Timeframe, FlowWindow>>;
}

interface JupiterStats {
  priceChange?: number;
  numBuys?: number;
  numSells?: number;
  numOrganicBuyers?: number;
  buyVolume?: number;
  sellVolume?: number;
}

interface JupiterToken {
  id?: string;
  usdPrice?: number;
  liquidity?: number;
  stats5m?: JupiterStats;
  stats1h?: JupiterStats;
  stats6h?: JupiterStats;
  stats24h?: JupiterStats;
}

function fromStats(stats: JupiterStats | undefined): FlowWindow | null {
  if (!stats || typeof stats.priceChange !== "number" || !Number.isFinite(stats.priceChange)) return null;
  const buys = num(stats.numBuys);
  const sells = num(stats.numSells);
  const volumeUsd = num(stats.buyVolume) + num(stats.sellVolume);
  if (buys + sells === 0 && volumeUsd === 0 && stats.priceChange === 0) return null;
  return {
    buys,
    sells,
    buyers: num(stats.numOrganicBuyers),
    sellers: 0,
    volumeUsd,
    priceChangePct: stats.priceChange,
  };
}

/** Close-to-close percent from the last two bars. */
export function moveFromCloses(prev: number, last: number): number | null {
  if (!(prev > 0) || !(last > 0)) return null;
  return ((last - prev) / prev) * 100;
}

/**
 * Replace windows that printed nothing. A live gecko window stays, so a deep pool
 * is not overwritten by the token-wide average.
 */
export function applyJupiterTape(token: TokenCandidate, tape: JupiterTape | null): TokenCandidate {
  if (!tape) return token;
  const flows = { ...token.flows };
  let changed = false;
  for (const tf of Object.keys(tape.windows) as Timeframe[]) {
    const next = tape.windows[tf];
    if (!next || !windowIsQuiet(flows[tf])) continue;
    flows[tf] = next;
    changed = true;
  }
  const thin = token.liquidityUsd < 80_000 && tape.liquidityUsd >= 80_000;
  const priceOff =
    tape.priceUsd > 0 &&
    token.priceUsd > 0 &&
    (tape.priceUsd / token.priceUsd > 1.4 || token.priceUsd / tape.priceUsd > 1.4);
  if (!changed && !thin && !priceOff) return token;
  return {
    ...token,
    flows,
    liquidityUsd: thin ? tape.liquidityUsd : token.liquidityUsd,
    volume24hUsd: thin ? Math.max(token.volume24hUsd, tape.volume24hUsd) : token.volume24hUsd,
    priceUsd: priceOff || !(token.priceUsd > 0) ? tape.priceUsd || token.priceUsd : token.priceUsd,
  };
}

function tapeFromToken(row: JupiterToken, m15: FlowWindow | null): JupiterTape | null {
  const windows: Partial<Record<Timeframe, FlowWindow>> = {};
  const m5 = fromStats(row.stats5m);
  const h1 = fromStats(row.stats1h);
  const h6 = fromStats(row.stats6h);
  const h24 = fromStats(row.stats24h);
  if (m5) windows.m5 = m5;
  if (h1) windows.h1 = h1;
  if (h6) windows.h6 = h6;
  if (h24) windows.h24 = h24;
  if (m15) windows.m15 = m15;
  const priceUsd = num(row.usdPrice);
  const liquidityUsd = num(row.liquidity);
  const volume24hUsd = h24?.volumeUsd ?? 0;
  if (!Object.keys(windows).length && !(liquidityUsd > 0)) return null;
  return { priceUsd, liquidityUsd, volume24hUsd, windows };
}

async function fifteenMinuteWindow(mint: string): Promise<FlowWindow | null> {
  const json = await fetchJson<{ candles?: unknown }>(jupiterChartUrl(mint, Date.now(), 4, "15_MINUTE"), {
    timeoutMs: 6_000,
    retries: 1,
  });
  const rows = parseJupiterCandles(json.candles);
  if (rows.length < 2) return null;
  const prev = rows[rows.length - 2];
  const last = rows[rows.length - 1];
  const priceChangePct = moveFromCloses(prev?.close ?? 0, last?.close ?? 0);
  if (priceChangePct === null) return null;
  return {
    buys: 0,
    sells: 0,
    buyers: 0,
    sellers: 0,
    volumeUsd: last?.volume ?? 0,
    priceChangePct,
  };
}

let cache: { at: number; rows: Map<string, JupiterTape> } | null = null;

/** One Jupiter read for the whole book. A miss leaves the gecko tape in place. */
export async function loadJupiterTapes(mints: readonly string[]): Promise<Map<string, JupiterTape>> {
  const unique = [...new Set(mints.filter(Boolean))];
  if (!unique.length) return new Map();
  if (cache && Date.now() - cache.at < TAPE_MS && unique.every((mint) => cache?.rows.has(mint))) return cache.rows;
  const json = await fetchJson<JupiterToken[]>(`${SEARCH_URL}${unique.join(",")}`, { timeoutMs: 6_000, retries: 1 });
  const rows = Array.isArray(json) ? json : [];
  const moves = await Promise.all(unique.map(async (mint) => fifteenMinuteWindow(mint).catch(() => null)));
  const out = new Map<string, JupiterTape>();
  unique.forEach((mint, index) => {
    const row = rows.find((item) => item.id === mint);
    if (!row) return;
    const tape = tapeFromToken(row, moves[index] ?? null);
    if (tape) out.set(mint, tape);
  });
  cache = { at: Date.now(), rows: out };
  return out;
}
