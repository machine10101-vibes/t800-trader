import { sameMint } from "@/lib/chain";
import { FRAME_SECONDS, rollUp, type Frame } from "@/lib/market/frames";
import {
  CRIMECAT_MINT,
  CRIMECAT_POOL,
  CRO_POOL,
  MERY_MINT,
  MERY_POOL,
  PACK_MINT,
  ULTCAT_MINT,
  ULTCAT_POOL,
  ULTI_MINT,
  ULTI_POOL,
  WCRO_MINT,
  bookPools,
} from "@/lib/market/universe";
import type { Candle } from "@/lib/types";
import { num } from "@/lib/utils";

export const VVS_GRAPH = [
  "https://graph.vvs.finance/subgraphs/name/vvs/exchange",
  "https://graph.cronoslabs.com/subgraphs/name/vvs/exchange",
] as const;

/** Named book pools that already sit on VVS. PACK's book pool is not the VVS PACK/WCRO pair. */
export const VVS_BOOK_PAIRS: Record<string, string> = {
  [WCRO_MINT.toLowerCase()]: CRO_POOL,
  [ULTCAT_MINT.toLowerCase()]: ULTCAT_POOL,
  [CRIMECAT_MINT.toLowerCase()]: CRIMECAT_POOL,
  [MERY_MINT.toLowerCase()]: MERY_POOL,
  [PACK_MINT.toLowerCase()]: "0xcc2f3b5d2f1f154d31344b07e18335485d2ca57d",
  [ULTI_MINT.toLowerCase()]: ULTI_POOL,
};

const FIVE_SEC = FRAME_SECONDS["5m"];
const HOUR_SEC = FRAME_SECONDS["1h"];
const SWAP_LOOKBACK_SEC = 26 * 3600;
const SWAP_PAGE = 1000;
const SWAP_PAGES = 3;
const HOUR_BARS = 400;

export interface VvsSwap {
  timestamp: number;
  amount0In: number;
  amount1In: number;
  amount0Out: number;
  amount1Out: number;
  amountUSD: number;
}

export interface VvsHour {
  hourStartUnix: number;
  reserve0: number;
  reserve1: number;
  reserveUSD: number;
  hourlyVolumeUSD: number;
}

export interface VvsPairMeta {
  id: string;
  token0: string;
  token1: string;
}

export interface VvsFrameBook {
  pair: VvsPairMeta;
  minutes: Candle[];
  five: Candle[];
  hourly: Candle[];
}

const pairCache = new Map<string, { at: number; pair: VvsPairMeta | null }>();
const PAIR_TTL_MS = 10 * 60_000;
const frameBookCache = new Map<string, { at: number; book: VvsFrameBook | null }>();
const FRAME_TTL_MS = 45_000;

function dec(value: unknown): number {
  return num(value, 0);
}

export function vvsPairId(mint: string): string | null {
  const known = VVS_BOOK_PAIRS[mint.toLowerCase()];
  if (known) return known.toLowerCase();
  const pin = bookPools("cronos").find((row) => sameMint(row.mint, mint))?.pool;
  return pin ? pin.toLowerCase() : null;
}

export function mintUsdFromReserves(hour: VvsHour, mintIsToken0: boolean): number {
  const reserve = mintIsToken0 ? hour.reserve0 : hour.reserve1;
  if (!(reserve > 0) || !(hour.reserveUSD > 0)) return 0;
  return hour.reserveUSD / 2 / reserve;
}

export function swapMintUsd(swap: VvsSwap, mintIsToken0: boolean): number | null {
  if (!(swap.amountUSD > 0)) return null;
  const qty = mintIsToken0
    ? Math.max(swap.amount0In, swap.amount0Out)
    : Math.max(swap.amount1In, swap.amount1Out);
  if (!(qty > 0)) return null;
  const px = swap.amountUSD / qty;
  return px > 0 ? px : null;
}

/** One snapshot an hour. Open is the prior close so the 1-hour chart still has a wick. */
export function hoursToCandles(hours: VvsHour[], mintIsToken0: boolean): Candle[] {
  const rows = [...hours].sort((a, b) => a.hourStartUnix - b.hourStartUnix);
  const out: Candle[] = [];
  let prev = 0;
  for (const hour of rows) {
    const close = mintUsdFromReserves(hour, mintIsToken0);
    if (!(close > 0)) continue;
    const open = prev > 0 ? prev : close;
    out.push({
      time: hour.hourStartUnix,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      volume: Math.max(0, hour.hourlyVolumeUSD),
    });
    prev = close;
  }
  return out;
}

export function swapsToCandles(swaps: VvsSwap[], mintIsToken0: boolean, seconds: number): Candle[] {
  const buckets = new Map<number, Candle>();
  const rows = [...swaps].sort((a, b) => a.timestamp - b.timestamp);
  for (const swap of rows) {
    const px = swapMintUsd(swap, mintIsToken0);
    if (px === null) continue;
    const time = Math.floor(swap.timestamp / seconds) * seconds;
    const last = buckets.get(time);
    if (!last) {
      buckets.set(time, { time, open: px, high: px, low: px, close: px, volume: swap.amountUSD });
      continue;
    }
    last.high = Math.max(last.high, px);
    last.low = Math.min(last.low, px);
    last.close = px;
    last.volume += swap.amountUSD;
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}

/** Quiet VVS pairs leave empty 5-minute windows. Carry the last close so the chart still has a tape. */
export function fillEmptyBuckets(candles: Candle[], seconds: number, untilSec = Math.floor(Date.now() / 1000)): Candle[] {
  if (!candles.length) return [];
  const rows = [...candles].sort((a, b) => a.time - b.time);
  const start = rows[0]!.time;
  const end = Math.max(rows[rows.length - 1]!.time, Math.floor(untilSec / seconds) * seconds);
  const byTime = new Map(rows.map((row) => [row.time, row]));
  const out: Candle[] = [];
  let prev = rows[0]!;
  for (let t = start; t <= end; t += seconds) {
    const hit = byTime.get(t);
    if (hit) {
      out.push({ ...hit });
      prev = hit;
      continue;
    }
    out.push({ time: t, open: prev.close, high: prev.close, low: prev.close, close: prev.close, volume: 0 });
  }
  return out;
}

async function postGraphql<T>(url: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (typeof window === "undefined") headers["User-Agent"] = "t800-trader/0.1";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers,
      body: JSON.stringify({ query, variables }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    const json = (await res.json()) as { data?: T; errors?: { message?: string }[] };
    if (json.errors?.length) throw new Error(json.errors[0]?.message || "VVS graph error");
    if (!json.data) throw new Error("VVS graph returned no data");
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

async function vvsGraphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  let last: unknown;
  for (const url of VVS_GRAPH) {
    try {
      return await postGraphql<T>(url, query, variables);
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("VVS chart feed missed");
}

async function readPair(id: string): Promise<VvsPairMeta | null> {
  const data = await vvsGraphql<{
    pair: { id: string; token0: { id: string }; token1: { id: string } } | null;
  }>(`query($id: ID!) { pair(id: $id) { id token0 { id } token1 { id } } }`, { id });
  const pair = data.pair;
  if (!pair) return null;
  return { id: pair.id.toLowerCase(), token0: pair.token0.id.toLowerCase(), token1: pair.token1.id.toLowerCase() };
}

async function deepestMintPair(mint: string): Promise<VvsPairMeta | null> {
  const key = mint.toLowerCase();
  const q = (side: "token0" | "token1") =>
    vvsGraphql<{
      pairs: { id: string; reserveUSD: string; token0: { id: string }; token1: { id: string } }[];
    }>(
      `query($mint: String!) { pairs(first: 5, orderBy: reserveUSD, orderDirection: desc, where: { ${side}: $mint }) { id reserveUSD token0 { id } token1 { id } } }`,
      { mint: key },
    );
  const [a, b] = await Promise.all([q("token0").catch(() => ({ pairs: [] })), q("token1").catch(() => ({ pairs: [] }))]);
  const rows = [...a.pairs, ...b.pairs].sort((x, y) => dec(y.reserveUSD) - dec(x.reserveUSD));
  const best = rows[0];
  if (!best) return null;
  return { id: best.id.toLowerCase(), token0: best.token0.id.toLowerCase(), token1: best.token1.id.toLowerCase() };
}

export async function resolveVvsPair(mint: string): Promise<VvsPairMeta | null> {
  const key = mint.toLowerCase();
  const hit = pairCache.get(key);
  if (hit && Date.now() - hit.at < PAIR_TTL_MS) return hit.pair;
  const pinned = vvsPairId(mint);
  let pair = pinned ? await readPair(pinned).catch(() => null) : null;
  if (!pair) pair = await deepestMintPair(mint).catch(() => null);
  pairCache.set(key, { at: Date.now(), pair });
  return pair;
}

function asSwap(row: Record<string, string>): VvsSwap {
  return {
    timestamp: dec(row.timestamp),
    amount0In: dec(row.amount0In),
    amount1In: dec(row.amount1In),
    amount0Out: dec(row.amount0Out),
    amount1Out: dec(row.amount1Out),
    amountUSD: dec(row.amountUSD),
  };
}

async function readSwaps(pair: string, since: number): Promise<VvsSwap[]> {
  const out: VvsSwap[] = [];
  let before = 0;
  for (let page = 0; page < SWAP_PAGES; page += 1) {
    const where = before
      ? `{ pair: $pair, timestamp_gt: $since, timestamp_lt: $before }`
      : `{ pair: $pair, timestamp_gt: $since }`;
    const data = await vvsGraphql<{ swaps: Record<string, string>[] }>(
      `query($pair: String!, $since: BigInt!, $before: BigInt) {
        swaps(first: ${SWAP_PAGE}, orderBy: timestamp, orderDirection: desc, where: ${where}) {
          timestamp amount0In amount1In amount0Out amount1Out amountUSD
        }
      }`,
      { pair, since: String(since), before: before ? String(before) : undefined },
    );
    const rows = (data.swaps ?? []).map(asSwap).filter((row) => row.timestamp > 0);
    out.push(...rows);
    if (rows.length < SWAP_PAGE) break;
    const oldest = rows[rows.length - 1]?.timestamp ?? 0;
    if (!(oldest > since)) break;
    before = oldest;
  }
  return out;
}

async function readHours(pair: string): Promise<VvsHour[]> {
  const data = await vvsGraphql<{
    pairHourDatas: {
      hourStartUnix: number;
      reserve0: string;
      reserve1: string;
      reserveUSD: string;
      hourlyVolumeUSD: string;
    }[];
  }>(
    `query($pair: String!) {
      pairHourDatas(first: ${HOUR_BARS}, orderBy: hourStartUnix, orderDirection: desc, where: { pair: $pair }) {
        hourStartUnix reserve0 reserve1 reserveUSD hourlyVolumeUSD
      }
    }`,
    { pair },
  );
  return (data.pairHourDatas ?? []).map((row) => ({
    hourStartUnix: dec(row.hourStartUnix),
    reserve0: dec(row.reserve0),
    reserve1: dec(row.reserve1),
    reserveUSD: dec(row.reserveUSD),
    hourlyVolumeUSD: dec(row.hourlyVolumeUSD),
  }));
}

export async function loadVvsFrames(mint: string): Promise<VvsFrameBook | null> {
  const cacheKey = mint.toLowerCase();
  const hit = frameBookCache.get(cacheKey);
  if (hit && Date.now() - hit.at < FRAME_TTL_MS) return hit.book;
  const pair = await resolveVvsPair(mint);
  if (!pair) return null;
  const mintIsToken0 = sameMint(pair.token0, mint);
  if (!mintIsToken0 && !sameMint(pair.token1, mint)) return null;
  const since = Math.floor(Date.now() / 1000) - SWAP_LOOKBACK_SEC;
  const [swaps, hours] = await Promise.all([readSwaps(pair.id, since).catch(() => []), readHours(pair.id).catch(() => [])]);
  const minutes = swapsToCandles(swaps, mintIsToken0, 60);
  const fiveRaw = minutes.length ? rollUp(minutes, FIVE_SEC) : swapsToCandles(swaps, mintIsToken0, FIVE_SEC);
  const five = fillEmptyBuckets(fiveRaw, FIVE_SEC);
  const hourly = hoursToCandles(hours, mintIsToken0);
  if (!five.length && !hourly.length) {
    frameBookCache.set(cacheKey, { at: Date.now(), book: null });
    return null;
  }
  const book = { pair, minutes, five, hourly };
  frameBookCache.set(cacheKey, { at: Date.now(), book });
  return book;
}

export function vvsSeries(book: VvsFrameBook, frame: Frame): Candle[] {
  if (frame === "5m") return book.five;
  if (frame === "15m") return rollUp(book.five, FRAME_SECONDS["15m"]);
  if (frame === "1h") return book.hourly.length ? book.hourly : rollUp(book.five, HOUR_SEC);
  return book.hourly.length ? rollUp(book.hourly, FRAME_SECONDS["4h"]) : rollUp(book.five, FRAME_SECONDS["4h"]);
}
