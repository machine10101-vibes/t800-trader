import type { ChainId } from "@/lib/chain";
import { sameMint } from "@/lib/chain";
import type { Candle, FlowWindow, MarketRegime, Timeframe, TokenCandidate } from "@/lib/types";
import { fetchJson, hoursSince, num, nullableNum, sleep, uniqueBy } from "@/lib/utils";
import { derivedFrames, enoughFrameBars, FRAME_BARS, FRAME_REFRESH_MS, frameKey, FRAMES, geckoFrameUrl, jupiterInterval, MIN_FOUR_HOUR_BARS, sourceFrame, type Frame } from "./frames";
import { jupiterChartUrl, parseJupiterCandles } from "./jupiterChart";
import { applyJupiterTape, loadJupiterTapes, type JupiterTape } from "./jupiterTape";
import { liveMajors } from "./marks";
import { paintRegime } from "./regime";
import { crossCheck, type YieldQuote } from "./quotes";
import { venueForDex } from "./venues";
import {
  CANDLE_COOL_MS,
  CHART_BARS,
  CHART_CANDLE_MS,
  CORE_CANDLE_MS,
  geckoHourlyChartUrl,
  mintsToFetch,
  POPULAR_CANDLE_MS,
  poolsToCandle,
} from "./ohlcvPlan";
import { pushTapeMark, withCandleTape } from "./tape";
import {
  bookMints,
  bookPools,
  bookTokens,
  classifySector,
  coreBookMints,
  geckoNetwork,
  isActiveBook,
  isQuote,
  WCRO_MINT,
  isStable,
  SOL_MINT,
  SOL_USDC_POOLS,
  watchMeta,
} from "./universe";

const TIMEFRAMES: Timeframe[] = ["m5", "m15", "m30", "h1", "h6", "h24"];

interface GtPool {
  id: string;
  attributes: {
    address: string;
    name: string;
    pool_created_at: string | null;
    fdv_usd: string | null;
    market_cap_usd: string | null;
    base_token_price_usd: string | null;
    reserve_in_usd: string | null;
    price_change_percentage?: Record<string, string>;
    transactions?: Record<string, { buys?: number; sells?: number; buyers?: number; sellers?: number }>;
    volume_usd?: Record<string, string>;
  };
  relationships?: {
    base_token?: { data?: { id: string } };
    quote_token?: { data?: { id: string } };
    dex?: { data?: { id: string } };
  };
}

interface GtToken {
  id: string;
  type: string;
  attributes: {
    address?: string;
    symbol?: string;
    name?: string;
  };
}

interface CgGlobal {
  data: {
    market_cap_percentage?: { btc?: number; eth?: number };
    total_market_cap?: { usd?: number };
    market_cap_change_percentage_24h_usd?: number;
  };
}

interface CgSimple {
  [id: string]: {
    usd: number;
    usd_market_cap: number;
    usd_24h_vol: number;
    usd_24h_change: number;
  };
}

interface MarketSnap {
  at: number;
  candidates: TokenCandidate[];
  regime: MarketRegime;
}

interface MarketSlot {
  cache: MarketSnap | null;
  lastBook: Map<string, TokenCandidate>;
  inflight: Promise<{ candidates: TokenCandidate[]; regime: MarketRegime; scanned: number }> | null;
}

function blankMarket(): MarketSlot {
  return { cache: null, lastBook: new Map(), inflight: null };
}

const markets: Record<ChainId, MarketSlot> = {
  solana: blankMarket(),
  cronos: blankMarket(),
};

function bookKey(mint: string): string {
  return mint.startsWith("0x") || mint.startsWith("0X") ? mint.toLowerCase() : mint;
}

/** A missed GeckoTerminal read must not erase the last print on this chain. */
function bookComplete(rows: TokenCandidate[], chain: ChainId): boolean {
  return coreBookMints(chain).every((mint) => rows.some((row) => sameMint(row.mint, mint)));
}

function quietFlows(): Record<Timeframe, FlowWindow> {
  const quiet: FlowWindow = { buys: 0, sells: 0, buyers: 0, sellers: 0, volumeUsd: 0, priceChangePct: 0 };
  return {
    m5: { ...quiet },
    m15: { ...quiet },
    m30: { ...quiet },
    h1: { ...quiet },
    h6: { ...quiet },
    h24: { ...quiet },
  };
}

/** Pinned book rows so Jupiter can stamp prices when GeckoTerminal is cooling. */
export function skeletonBook(chain: ChainId): TokenCandidate[] {
  return bookTokens(chain).flatMap((token) => {
    const pin = bookPools(chain).find((row) => sameMint(row.mint, token.mint))?.pool;
    if (!pin) return [];
    return [
      {
        id: token.mint,
        chain,
        symbol: token.symbol,
        name: token.name,
        mint: token.mint,
        poolAddress: pin,
        dex: chain === "cronos" ? "vvs" : "raydium",
        quoteSymbol: chain === "cronos" || token.mint === SOL_MINT ? "USDC" : "SOL",
        priceUsd: token.priceUsd ?? 0,
        marketCapUsd: null,
        fdvUsd: null,
        liquidityUsd: 0,
        volume24hUsd: 0,
        poolCreatedAt: null,
        ageHours: null,
        sector: token.sector,
        flows: quietFlows(),
        watchlist: true,
        sources: ["book"],
        priceAgreement: "thin",
        apyPct: null,
        apySources: [],
      },
    ];
  });
}

function fillActiveBook(rows: TokenCandidate[], chain: ChainId): TokenCandidate[] {
  const slot = markets[chain];
  const out = [...rows];
  for (const mint of bookMints(chain)) {
    const row = out.find((candidate) => sameMint(candidate.mint, mint));
    const key = bookKey(mint);
    if (row) slot.lastBook.set(key, row);
    else {
      const prev = slot.lastBook.get(key);
      if (prev) out.push(prev);
    }
  }
  return out;
}

const CACHE_MS = 6_000;

function mintFromGtId(id: string | undefined): string {
  if (!id) return "";
  const cut = id.indexOf("_");
  if (cut <= 0) return id;
  return id.slice(cut + 1);
}

function flowsFromPool(attrs: GtPool["attributes"]): Record<Timeframe, FlowWindow> {
  const out = {} as Record<Timeframe, FlowWindow>;
  for (const tf of TIMEFRAMES) {
    const tx = attrs.transactions?.[tf] ?? {};
    out[tf] = {
      buys: num(tx.buys),
      sells: num(tx.sells),
      buyers: num(tx.buyers),
      sellers: num(tx.sellers),
      volumeUsd: num(attrs.volume_usd?.[tf]),
      priceChangePct: num(attrs.price_change_percentage?.[tf]),
    };
  }
  return out;
}

function tokenMap(included: GtToken[] | undefined): Map<string, GtToken> {
  const map = new Map<string, GtToken>();
  for (const t of included ?? []) {
    if (t.type === "token") map.set(t.id, t);
  }
  return map;
}

function toCandidate(pool: GtPool, tokens: Map<string, GtToken>, source: string, chain: ChainId): TokenCandidate | null {
  const baseId = pool.relationships?.base_token?.data?.id;
  const quoteId = pool.relationships?.quote_token?.data?.id;
  const base = tokens.get(baseId ?? "");
  const quote = tokens.get(quoteId ?? "");
  const mint = mintFromGtId(baseId) || base?.attributes.address || "";
  const quoteMint = mintFromGtId(quoteId);
  const symbol = (base?.attributes.symbol || pool.attributes.name.split(" / ")[0] || "UNK").toUpperCase();
  const quoteSymbol = (quote?.attributes.symbol || pool.attributes.name.split(" / ")[1] || "").toUpperCase();
  if (!mint || !pool.attributes.address) return null;
  if (isStable(symbol)) return null;
  if (quoteSymbol && !isQuote(quoteSymbol)) return null;
  if (mint === SOL_MINT && !quoteMint) return null;

  const watch = watchMeta(mint, chain);
  const name = watch?.name || base?.attributes.name || symbol;
  const created = pool.attributes.pool_created_at;

  return {
    id: mint,
    chain,
    symbol,
    name,
    mint,
    poolAddress: pool.attributes.address,
    dex: pool.relationships?.dex?.data?.id || "unknown",
    quoteSymbol: quoteSymbol || "SOL",
    priceUsd: num(pool.attributes.base_token_price_usd),
    marketCapUsd: nullableNum(pool.attributes.market_cap_usd),
    fdvUsd: nullableNum(pool.attributes.fdv_usd),
    liquidityUsd: num(pool.attributes.reserve_in_usd),
    volume24hUsd: num(pool.attributes.volume_usd?.h24),
    poolCreatedAt: created,
    ageHours: hoursSince(created),
    sector: watch?.sector || classifySector(symbol, name),
    flows: flowsFromPool(pool.attributes),
    watchlist: Boolean(watch),
    sources: [source],
    priceAgreement: "thin",
    apyPct: null,
    apySources: [],
  };
}

const GECKO_GAP_MS = 2_100;
const GECKO_COOL_MS = 8_000;
let geckoTail: Promise<void> = Promise.resolve();
let geckoNotBefore = 0;

function noteGeckoResult(error?: unknown): void {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("429")) geckoNotBefore = Date.now() + GECKO_COOL_MS;
  else geckoNotBefore = Math.max(geckoNotBefore, Date.now() + GECKO_GAP_MS);
}

/** True while GeckoTerminal is in the 429 cool-down. Solana can scan from Jupiter instead. */
export function geckoIsCooling(): boolean {
  return geckoNotBefore > Date.now();
}

/** One GeckoTerminal call at a time. A 429 pauses the whole book so candles are not burned. */
function paceGecko<T>(task: () => Promise<T>): Promise<T> {
  const run = geckoTail.then(async () => {
    const wait = geckoNotBefore - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const value = await task();
      noteGeckoResult();
      return value;
    } catch (error) {
      noteGeckoResult(error);
      throw error;
    }
  });
  geckoTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function gtPools(path: string, source: string, chain: ChainId): Promise<TokenCandidate[]> {
  const url = `https://api.geckoterminal.com/api/v2/${path}${path.includes("?") ? "&" : "?"}include=base_token,quote_token`;
  const json = await paceGecko(() => fetchJson<{ data: GtPool[]; included?: GtToken[] }>(url, { timeoutMs: 6_000, retries: 1 }));
  const tokens = tokenMap(json.included);
  return json.data.map((p) => toCandidate(p, tokens, source, chain)).filter((x): x is TokenCandidate => Boolean(x));
}

const poolPriceCache = new Map<string, { at: number; price: number }>();

/** Spot price for an open ticket whose mint is no longer on the scanned book. */
export async function livePoolPrice(pool: string, chain: ChainId): Promise<number | null> {
  if (!pool) return null;
  const key = `${chain}:${pool}`;
  const hit = poolPriceCache.get(key);
  if (hit && hit.price > 0 && Date.now() - hit.at < 15_000) return hit.price;
  const row = await gtPool(pool, "geckoterminal:mark", chain).catch(() => null);
  const price = row && row.priceUsd > 0 ? row.priceUsd : null;
  if (price) poolPriceCache.set(key, { at: Date.now(), price });
  return price;
}

async function gtPool(address: string, source: string, chain: ChainId): Promise<TokenCandidate | null> {
  const url = `https://api.geckoterminal.com/api/v2/networks/${geckoNetwork(chain)}/pools/${address}?include=base_token,quote_token`;
  const json = await paceGecko(() => fetchJson<{ data: GtPool; included?: GtToken[] }>(url, { timeoutMs: 5_000, retries: 1 }));
  return toCandidate(json.data, tokenMap(json.included), source, chain);
}

function stampWatch(row: TokenCandidate, mint: string, chain: ChainId): TokenCandidate {
  const meta = watchMeta(mint, chain);
  if (!meta) return { ...row, watchlist: true };
  return { ...row, watchlist: true, symbol: meta.symbol, name: meta.name, sector: meta.sector, mint: meta.mint };
}

async function poolsForMint(mint: string, symbol: string, chain: ChainId): Promise<TokenCandidate[]> {
  const pools = await gtPools(
    `networks/${geckoNetwork(chain)}/tokens/${mint}/pools?page=1`,
    `geckoterminal:token:${symbol}`,
    chain,
  );
  return pools.filter((p) => sameMint(p.mint, mint)).map((p) => stampWatch(p, mint, chain));
}

async function pinnedPool(mint: string, symbol: string, pin: string, chain: ChainId): Promise<TokenCandidate | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const row = await gtPool(pin, `geckoterminal:pool:${symbol}`, chain);
      if (row && sameMint(row.mint, mint)) return stampWatch(row, mint, chain);
      return null;
    } catch {
      if (attempt === 0) await sleep(400);
    }
  }
  return null;
}

interface PoolSnap {
  at: number;
  rows: TokenCandidate[];
}

const poolSnaps = new Map<string, PoolSnap>();
const poolMint = new Map<string, string>();

function snapId(chain: ChainId, mint: string): string {
  return `${chain}:${bookKey(mint)}`;
}

function rememberRows(rows: TokenCandidate[]): void {
  for (const row of rows) {
    if (row.poolAddress && row.mint) poolMint.set(row.poolAddress, row.mint);
  }
}

async function watchlistPools(chain: ChainId): Promise<TokenCandidate[]> {
  const book = bookTokens(chain);
  const pins = bookPools(chain);
  const now = Date.now();
  const snaps = new Map<string, { at: number; ok: boolean }>();
  for (const token of book) {
    const snap = poolSnaps.get(snapId(chain, token.mint));
    if (snap) snaps.set(token.mint, { at: snap.at, ok: snap.rows.length > 0 });
  }
  const due = new Set(
    mintsToFetch(
      book.map((token) => ({
        mint: token.mint,
        pinned: pins.some((row) => sameMint(row.mint, token.mint)),
      })),
      snaps,
      now,
      2,
    ),
  );
  const pools: TokenCandidate[] = [];
  let paced = false;
  for (const token of book) {
    const key = snapId(chain, token.mint);
    const snap = poolSnaps.get(key);
    if (!due.has(token.mint)) {
      if (snap?.rows.length) pools.push(...snap.rows);
      continue;
    }
    if (geckoIsCooling()) {
      if (snap?.rows.length) pools.push(...snap.rows);
      continue;
    }
    if (paced) await sleep(450);
    paced = true;
    const pin = pins.find((row) => sameMint(row.mint, token.mint))?.pool ?? token.pool;
    let rows: TokenCandidate[] = [];
    try {
      const pinned = pin ? await pinnedPool(token.mint, token.symbol, pin, chain) : null;
      rows = pinned ? [pinned] : await poolsForMint(token.mint, token.symbol, chain);
    } catch {
      rows = [];
    }
    poolSnaps.set(key, { at: Date.now(), rows });
    rememberRows(rows);
    pools.push(...rows);
  }
  const best = new Map<string, TokenCandidate>();
  for (const p of pools) {
    const key = `${p.mint}:${venueForDex(p.dex)}`;
    const prev = best.get(key);
    if (!prev || p.liquidityUsd > prev.liquidityUsd) best.set(key, p);
  }
  return [...best.values()];
}

function mergeCandidates(groups: TokenCandidate[][]): TokenCandidate[] {
  const map = new Map<string, TokenCandidate>();
  for (const group of groups) {
    for (const c of group) {
      const key = `${c.mint}:${venueForDex(c.dex)}`;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, c);
        continue;
      }
      const richer = c.liquidityUsd > prev.liquidityUsd ? c : prev;
      richer.sources = uniqueBy([...prev.sources, ...c.sources], (s) => s);
      richer.watchlist = prev.watchlist || c.watchlist;
      if (prev.watchlist) {
        richer.sector = prev.sector;
        richer.name = prev.name;
        richer.symbol = prev.symbol;
      }
      map.set(key, richer);
    }
  }
  return [...map.values()];
}

const ohlcvCache = new Map<string, { at: number; rows: Candle[] }>();
const ohlcvMiss = new Map<string, number>();
const OHLCV_TTL_MS = POPULAR_CANDLE_MS;
const OHLCV_STALE_MS = 20 * 60_000;
const OHLCV_MISS_MS = CANDLE_COOL_MS;
const OHLCV_PARALLEL = 1;
let ohlcvActive = 0;
const ohlcvWaiters: (() => void)[] = [];

function acquireOhlcv(): Promise<void> {
  if (ohlcvActive < OHLCV_PARALLEL) {
    ohlcvActive += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    ohlcvWaiters.push(() => {
      ohlcvActive += 1;
      resolve();
    });
  });
}

function releaseOhlcv(): void {
  ohlcvActive -= 1;
  const next = ohlcvWaiters.shift();
  if (next) next();
}

function enqueueOhlcv<T>(task: () => Promise<T>): Promise<T> {
  return acquireOhlcv().then(async () => {
    try {
      return await task();
    } finally {
      releaseOhlcv();
    }
  });
}

function candlesFromOhlcv(json: {
  data?: { attributes?: { ohlcv_list?: [number, number, number, number, number, number][] } };
}): Candle[] {
  const list = json.data?.attributes?.ohlcv_list ?? [];
  return list
    .map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }))
    .sort((a, b) => a.time - b.time);
}

async function readOhlcv(url: string): Promise<Candle[]> {
  const json = await paceGecko(() =>
    fetchJson<{
      data?: { attributes?: { ohlcv_list?: [number, number, number, number, number, number][] } };
    }>(url, { timeoutMs: 8_000, retries: 0 }),
  );
  return candlesFromOhlcv(json);
}

/** Cronos book charts skip the 2.1s Gecko queue so all five names paint on login. */
async function readOhlcvDirect(url: string): Promise<Candle[]> {
  try {
    const json = await fetchJson<{
      data?: { attributes?: { ohlcv_list?: [number, number, number, number, number, number][] } };
    }>(url, { timeoutMs: 8_000, retries: 1 });
    noteGeckoResult();
    return candlesFromOhlcv(json);
  } catch (error) {
    noteGeckoResult(error);
    throw error;
  }
}

async function fetchOhlcvOnce(poolAddress: string, limit: number, chain: ChainId): Promise<Candle[]> {
  const poolUrl = `https://api.geckoterminal.com/api/v2/networks/${geckoNetwork(chain)}/pools/${poolAddress}/ohlcv/minute?aggregate=1&limit=${limit}`;
  const poolRows = await readOhlcv(poolUrl);
  if (poolRows.length) return poolRows;
  const mint = poolMint.get(poolAddress);
  if (!mint) return poolRows;
  const tokenUrl = `https://api.geckoterminal.com/api/v2/networks/${geckoNetwork(chain)}/tokens/${mint}/ohlcv/minute?aggregate=1&limit=${limit}`;
  return readOhlcv(tokenUrl).catch(() => poolRows);
}

/** Native 4-hour bars from the pool the desk trades. The token series is only a fallback. */
async function fetchChartOnce(poolAddress: string, chain: ChainId, opts?: { direct?: boolean }): Promise<Candle[]> {
  const read = opts?.direct ? readOhlcvDirect : readOhlcv;
  const network = geckoNetwork(chain);
  const poolRows = await read(geckoHourlyChartUrl(network, poolAddress, "pools"));
  if (poolRows.length) return poolRows;
  const mint = poolMint.get(poolAddress) ?? bookPools(chain).find((row) => row.pool.toLowerCase() === poolAddress.toLowerCase())?.mint;
  if (!mint) return poolRows;
  return read(geckoHourlyChartUrl(network, mint, "tokens")).catch(() => poolRows);
}

function staleCandles(poolAddress: string): Candle[] | null {
  const hit = ohlcvCache.get(poolAddress);
  if (hit?.rows.length && Date.now() - hit.at < OHLCV_STALE_MS) return hit.rows;
  return null;
}

export function cachedOhlcv(poolAddress: string): Candle[] | null {
  const hit = ohlcvCache.get(poolAddress);
  if (hit?.rows.length) return hit.rows;
  return null;
}

export function candleFetchedAt(poolAddress: string): number | null {
  const hit = ohlcvCache.get(poolAddress);
  return hit?.rows.length ? hit.at : null;
}

const tapeMarkCache = new Map<string, Candle[]>();

/** Keep the last live prints for a pool so the card can draw before OHLCV returns. */
export function rememberTapeMark(poolAddress: string, price: number, at = Date.now()): Candle[] {
  if (!poolAddress) return [];
  const next = pushTapeMark(tapeMarkCache.get(poolAddress) ?? [], price, at);
  tapeMarkCache.set(poolAddress, next);
  return next;
}

export function cachedTapeMarks(poolAddress: string): Candle[] {
  return tapeMarkCache.get(poolAddress) ?? [];
}

const ohlcvInflight = new Map<string, Promise<Candle[]>>();

export async function fetchOhlcv(
  poolAddress: string,
  limit = 120,
  chain: ChainId = "solana",
  opts?: { maxAge?: number },
): Promise<Candle[]> {
  const inflight = ohlcvInflight.get(poolAddress);
  if (inflight) return inflight;
  const run = loadOhlcv(poolAddress, limit, chain, opts?.maxAge ?? OHLCV_TTL_MS).finally(() => {
    if (ohlcvInflight.get(poolAddress) === run) ohlcvInflight.delete(poolAddress);
  });
  ohlcvInflight.set(poolAddress, run);
  return run;
}

async function loadOhlcv(poolAddress: string, limit: number, chain: ChainId, maxAge: number): Promise<Candle[]> {
  const hit = ohlcvCache.get(poolAddress);
  if (hit?.rows.length && Date.now() - hit.at < maxAge) return hit.rows;
  const missedAt = ohlcvMiss.get(poolAddress);
  if (missedAt && Date.now() - missedAt < OHLCV_MISS_MS) return staleCandles(poolAddress) ?? [];
  try {
    const rows = await enqueueOhlcv(() => fetchOhlcvOnce(poolAddress, Math.min(limit, 140), chain));
    if (rows.length) {
      ohlcvCache.set(poolAddress, { at: Date.now(), rows });
      ohlcvMiss.delete(poolAddress);
      return rows;
    }
    ohlcvMiss.set(poolAddress, Date.now());
    return staleCandles(poolAddress) ?? rows;
  } catch {
    ohlcvMiss.set(poolAddress, Date.now());
    return staleCandles(poolAddress) ?? [];
  }
}

export async function fetchOhlcvFromPools(poolAddresses: string[], limit = 120): Promise<Candle[]> {
  const ordered = uniqueBy([...poolAddresses.filter(Boolean), ...SOL_USDC_POOLS], (p) => p);
  for (const pool of ordered) {
    const hit = ohlcvCache.get(pool);
    if (hit?.rows.length && Date.now() - hit.at < OHLCV_TTL_MS) return hit.rows;
  }
  const retry = uniqueBy([ordered[0], ...SOL_USDC_POOLS], (p) => p).filter(Boolean);
  for (const pool of retry) {
    try {
      const rows = await fetchOhlcv(pool, limit);
      if (rows.length) return rows;
    } catch {
      // Next pool — research may have already 429'd this origin.
    }
  }
  return [];
}

const REGIME_FEED = { timeoutMs: 3_500, retries: 1 };

async function croMarkFallback(): Promise<{ price: number | null; change24h: number | null }> {
  const [llama, gecko] = await Promise.allSettled([
    fetchJson<{ coins?: Record<string, { price?: number }> }>(`https://coins.llama.fi/prices/current/cronos:${WCRO_MINT}`, REGIME_FEED),
    fetchJson<{
      data?: { attributes?: { token_prices?: Record<string, string> } };
    }>(`https://api.geckoterminal.com/api/v2/simple/networks/cro/token_price/${WCRO_MINT}`, REGIME_FEED),
  ]);
  const llamaPx =
    llama.status === "fulfilled" ? nullableNum(llama.value.coins?.[`cronos:${WCRO_MINT}`]?.price) : null;
  const prices = gecko.status === "fulfilled" ? gecko.value.data?.attributes?.token_prices ?? {} : {};
  const geckoPx = nullableNum(prices[WCRO_MINT] ?? prices[WCRO_MINT.toLowerCase()] ?? Object.values(prices)[0]);
  return { price: llamaPx ?? geckoPx, change24h: null };
}

async function fetchRegime(chain: ChainId = "solana"): Promise<MarketRegime> {
  const cronos = chain === "cronos";
  const geckoIds = cronos ? "bitcoin,ethereum,crypto-com-chain" : "bitcoin,ethereum,solana";
  const dexSlug = cronos ? "cronos" : "solana";
  const [prices, global, fng, chains, dexs] = await Promise.allSettled([
    fetchJson<CgSimple>(
      `https://api.coingecko.com/api/v3/simple/price?ids=${geckoIds}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`,
      REGIME_FEED,
    ),
    fetchJson<CgGlobal>("https://api.coingecko.com/api/v3/global", REGIME_FEED),
    fetchJson<{ data: { value: string; value_classification: string }[] }>("https://api.alternative.me/fng/?limit=1", REGIME_FEED),
    fetchJson<{ name: string; gecko_id?: string; tvl: number }[]>("https://api.llama.fi/v2/chains", REGIME_FEED),
    fetchJson<{ total24h?: number; change_1d?: number }>(
      `https://api.llama.fi/overview/dexs/${dexSlug}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`,
      REGIME_FEED,
    ),
  ]);

  const px = prices.status === "fulfilled" ? prices.value : null;
  const l1Gecko = cronos ? px?.["crypto-com-chain"] : px?.solana;
  const needFallback =
    !nullableNum(px?.bitcoin?.usd) || !nullableNum(px?.ethereum?.usd) || !nullableNum(l1Gecko?.usd);
  const fallback = !cronos && needFallback ? await liveMajors().catch(() => null) : null;
  const croFallback = cronos && needFallback ? await croMarkFallback().catch(() => null) : null;
  const g = global.status === "fulfilled" ? global.value.data : null;
  const fear = fng.status === "fulfilled" ? fng.value.data?.[0] : null;
  const chainList = chains.status === "fulfilled" ? chains.value : [];
  const l1Chain = cronos
    ? chainList.find((c) => c.name === "Cronos" || c.gecko_id === "crypto-com-chain" || c.gecko_id === "cronos")
    : chainList.find((c) => c.name === "Solana" || c.gecko_id === "solana");
  const dex = dexs.status === "fulfilled" ? dexs.value : null;

  const btcPx = nullableNum(px?.bitcoin?.usd) ?? fallback?.btc.price ?? null;
  const ethPx = nullableNum(px?.ethereum?.usd) ?? fallback?.eth.price ?? null;
  const l1Px = nullableNum(l1Gecko?.usd) ?? (cronos ? croFallback?.price : fallback?.sol.price) ?? null;
  const btc = {
    price: btcPx ?? 0,
    change24h: btcPx === null ? 0 : num(px?.bitcoin?.usd_24h_change ?? fallback?.btc.change24h),
    marketCap: num(px?.bitcoin?.usd_market_cap),
    volume24h: num(px?.bitcoin?.usd_24h_vol),
  };
  const eth = {
    price: ethPx ?? 0,
    change24h: ethPx === null ? 0 : num(px?.ethereum?.usd_24h_change ?? fallback?.eth.change24h),
    marketCap: num(px?.ethereum?.usd_market_cap),
    volume24h: num(px?.ethereum?.usd_24h_vol),
  };
  const sol = {
    price: l1Px ?? 0,
    change24h: l1Px === null ? 0 : num(l1Gecko?.usd_24h_change ?? (cronos ? croFallback?.change24h : fallback?.sol.change24h)),
    marketCap: num(l1Gecko?.usd_market_cap),
    volume24h: num(l1Gecko?.usd_24h_vol),
  };

  const btcDom = nullableNum(g?.market_cap_percentage?.btc);
  const painted = paintRegime({
    chain,
    btc,
    eth,
    l1: sol,
    btcDom,
    fear: fear ? { value: num(fear.value), label: fear.value_classification } : null,
    tvl: l1Chain?.tvl ?? null,
    dexVolume24h: dex?.total24h ?? null,
    dexChange1d: dex?.change_1d ?? null,
  });

  return {
    asOf: new Date().toISOString(),
    btc,
    eth,
    sol,
    btcDominance: btcDom,
    ethDominance: nullableNum(g?.market_cap_percentage?.eth),
    totalMarketCap: nullableNum(g?.total_market_cap?.usd),
    marketCapChange24h: nullableNum(g?.market_cap_change_percentage_24h_usd),
    fearGreed: fear ? { value: num(fear.value), label: fear.value_classification } : null,
    solanaTvl: l1Chain?.tvl ?? null,
    solanaDexVolume24h: dex?.total24h ?? null,
    solanaDexVolumeChange1d: dex?.change_1d ?? null,
    ...painted,
    yields: [],
  };
}

export async function loadMarket(force = false, chain: ChainId = "solana"): Promise<{
  candidates: TokenCandidate[];
  regime: MarketRegime;
  scanned: number;
}> {
  const slot = markets[chain];
  if (!force && slot.cache && Date.now() - slot.cache.at < CACHE_MS) {
    return { candidates: slot.cache.candidates, regime: slot.cache.regime, scanned: slot.cache.candidates.length };
  }
  if (!force && slot.inflight) return slot.inflight;

  const run = loadMarketOnce(chain);
  slot.inflight = run;
  void run.finally(() => {
    if (slot.inflight === run) slot.inflight = null;
  });
  return run;
}

interface CandleJob {
  pool: string;
  chain: ChainId;
  pinned: boolean;
}

const candleQueue: CandleJob[] = [];
let drainingCandles = false;

/** One candle read at a time. Charts with no bars jump the queue. */
export function requestBookCandles(pools: string[], chain: ChainId, pinned: ReadonlySet<string> = new Set()): void {
  const missing: CandleJob[] = [];
  const fresh: CandleJob[] = [];
  for (const pool of pools) {
    if (!pool || candleQueue.some((job) => job.pool === pool && job.chain === chain)) continue;
    const job = { pool, chain, pinned: pinned.has(pool) };
    if (cachedOhlcv(pool)?.length) fresh.push(job);
    else missing.push(job);
  }
  missing.sort((a, b) => Number(b.pinned) - Number(a.pinned));
  candleQueue.unshift(...missing);
  candleQueue.push(...fresh);
  if (drainingCandles) return;
  drainingCandles = true;
  void drainCandles();
}

async function drainCandles(): Promise<void> {
  try {
    while (candleQueue.length) {
      const job = candleQueue.shift();
      if (!job) break;
      const freshAt = new Map<string, number>();
      const missedAt = new Map<string, number>();
      const fetched = candleFetchedAt(job.pool);
      if (fetched !== null) freshAt.set(job.pool, fetched);
      const missed = ohlcvMiss.get(job.pool);
      if (missed) missedAt.set(job.pool, missed);
      const due = poolsToCandle([{ address: job.pool, pinned: job.pinned }], freshAt, missedAt, Date.now(), 1);
      if (!due.length) continue;
      await fetchOhlcv(job.pool, 120, job.chain, { maxAge: job.pinned ? CORE_CANDLE_MS : POPULAR_CANDLE_MS });
      await sleep(250);
    }
  } finally {
    drainingCandles = false;
    if (candleQueue.length) requestBookCandles([], "solana");
  }
}

const chartCache = new Map<string, { at: number; rows: Candle[] }>();
const chartMiss = new Map<string, number>();
const chartInflight = new Map<string, Promise<Candle[]>>();
const chartQueue: { pool: string; chain: ChainId }[] = [];
let drainingCharts = false;

export function cachedChart(poolAddress: string): Candle[] | null {
  const hit = chartCache.get(poolAddress);
  return hit?.rows.length ? hit.rows : null;
}

export function chartFetchedAt(poolAddress: string): number | null {
  const hit = chartCache.get(poolAddress);
  return hit?.rows.length ? hit.at : null;
}

async function loadChart(poolAddress: string, chain: ChainId): Promise<Candle[]> {
  const inflight = chartInflight.get(poolAddress);
  if (inflight) return inflight;
  const run = readChart(poolAddress, chain).finally(() => {
    if (chartInflight.get(poolAddress) === run) chartInflight.delete(poolAddress);
  });
  chartInflight.set(poolAddress, run);
  return run;
}

async function readChart(poolAddress: string, chain: ChainId): Promise<Candle[]> {
  const hit = chartCache.get(poolAddress);
  if (hit?.rows.length && Date.now() - hit.at < CHART_CANDLE_MS) return hit.rows;
  const missedAt = chartMiss.get(poolAddress);
  if (missedAt && Date.now() - missedAt < CANDLE_COOL_MS) return hit?.rows ?? [];
  try {
    const rows = await enqueueOhlcv(() => fetchChartOnce(poolAddress, chain));
    const capped = rows.slice(-CHART_BARS);
    if (capped.length) {
      chartCache.set(poolAddress, { at: Date.now(), rows: capped });
      chartMiss.delete(poolAddress);
      return capped;
    }
    chartMiss.set(poolAddress, Date.now());
    return hit?.rows ?? [];
  } catch {
    chartMiss.set(poolAddress, Date.now());
    return hit?.rows ?? [];
  }
}

const decisionCache = new Map<string, { at: number; rows: Candle[] }>();
const decisionMiss = new Map<string, number>();
const decisionInflight = new Map<string, Promise<Candle[]>>();

function decisionKey(chain: ChainId, mint: string): string {
  return `${chain}:${mint}`;
}

/** The 4-hour series the bot reads before it trades. Solana comes from Jupiter. */
export function cachedDecisionChart(mint: string, chain: ChainId = "solana"): Candle[] | null {
  const hit = decisionCache.get(decisionKey(chain, mint));
  if (hit?.rows.length) return hit.rows;
  if (chain !== "cronos") return null;
  const pool = bookPools(chain).find((row) => sameMint(row.mint, mint))?.pool;
  return pool ? cachedChart(pool) : null;
}

async function fetchJupiterDecision(mint: string): Promise<Candle[]> {
  const json = await fetchJson<{ candles?: unknown }>(jupiterChartUrl(mint, Date.now()), {
    timeoutMs: 8_000,
    retries: 1,
  });
  return parseJupiterCandles(json.candles);
}

export async function loadDecisionChart(mint: string, chain: ChainId = "solana"): Promise<Candle[]> {
  if (chain === "cronos") {
    const pool = bookPools(chain).find((row) => sameMint(row.mint, mint))?.pool;
    return pool ? loadCronosDecision(mint, pool, false) : [];
  }
  const key = decisionKey(chain, mint);
  const hit = decisionCache.get(key);
  if (hit?.rows.length && Date.now() - hit.at < CHART_CANDLE_MS) return hit.rows;
  const inflight = decisionInflight.get(key);
  if (inflight) return inflight;
  const run = readDecisionChart(mint, chain, key, hit?.rows ?? []).finally(() => {
    if (decisionInflight.get(key) === run) decisionInflight.delete(key);
  });
  decisionInflight.set(key, run);
  return run;
}

async function readDecisionChart(mint: string, chain: ChainId, key: string, stale: Candle[]): Promise<Candle[]> {
  if (chain === "cronos") {
    const pool = bookPools(chain).find((row) => sameMint(row.mint, mint))?.pool;
    return pool ? loadCronosDecision(mint, pool, false) : stale;
  }
  const missedAt = decisionMiss.get(key);
  if (missedAt && Date.now() - missedAt < CANDLE_COOL_MS) return stale;
  try {
    const rows = await fetchJupiterDecision(mint);
    if (rows.length) {
      decisionCache.set(key, { at: Date.now(), rows });
      decisionMiss.delete(key);
      return rows;
    }
    decisionMiss.set(key, Date.now());
    return stale;
  } catch {
    decisionMiss.set(key, Date.now());
    return stale;
  }
}

async function loadCronosDecision(mint: string, pool: string, force: boolean): Promise<Candle[]> {
  const key = decisionKey("cronos", mint);
  const hit = decisionCache.get(key);
  if (!force && hit?.rows.length && Date.now() - hit.at < CHART_CANDLE_MS) return hit.rows;
  const inflight = decisionInflight.get(key);
  if (inflight) return inflight;
  const run = (async () => {
    const missedAt = decisionMiss.get(key);
    const coolMs = hit?.rows.length ? CANDLE_COOL_MS : 2_000;
    if (!force && geckoIsCooling()) return hit?.rows ?? [];
    if (!force && missedAt && Date.now() - missedAt < coolMs) return hit?.rows ?? [];
    try {
      const rows = (await fetchChartOnce(pool, "cronos", { direct: true })).slice(-CHART_BARS);
      if (rows.length) {
        decisionCache.set(key, { at: Date.now(), rows });
        chartCache.set(pool, { at: Date.now(), rows });
        decisionMiss.delete(key);
        return rows;
      }
      decisionMiss.set(key, Date.now());
      return hit?.rows ?? [];
    } catch {
      decisionMiss.set(key, Date.now());
      return hit?.rows ?? [];
    }
  })().finally(() => {
    if (decisionInflight.get(key) === run) decisionInflight.delete(key);
  });
  decisionInflight.set(key, run);
  return run;
}

async function prefetchCronosDecisionCharts(force = false): Promise<void> {
  await Promise.all(bookPools("cronos").map(({ mint, pool }) => loadCronosDecision(mint, pool, force)));
}

/** Start a 4-hour read for every tradable mint. Cronos pulls the named book at once. */
export function requestDecisionCharts(mints: string[], chain: ChainId): void {
  if (chain === "cronos") {
    void prefetchCronosDecisionCharts();
    return;
  }
  for (const mint of mints) {
    if (!mint) continue;
    void loadDecisionChart(mint, chain);
  }
}

/** Login and refresh start here. Solana reads Jupiter. Cronos does not wait on the wallet. */
export function prefetchDecisionCharts(chain: ChainId): Promise<void> {
  return prefetchFrameCharts(chain);
}

const frameCache = new Map<string, { at: number; rows: Candle[] }>();
const frameMiss = new Map<string, number>();
const frameInflight = new Map<string, Promise<void>>();

function rememberFrames(chain: ChainId, mint: string, source: Frame, rows: Candle[]): void {
  const at = Date.now();
  const filled = derivedFrames(rows, source);
  for (const frame of FRAMES) {
    const series = filled[frame];
    if (!series?.length) continue;
    const key = frameKey(chain, mint, frame);
    const hit = frameCache.get(key);
    if (hit?.rows.length && hit.rows.length >= series.length && frame !== source) continue;
    frameCache.set(key, { at, rows: series.slice(-1000) });
  }
  if (source === "4h" || (filled["4h"]?.length ?? 0) >= MIN_FOUR_HOUR_BARS) {
    const four = (source === "4h" ? rows : filled["4h"]) ?? [];
    if (four.length) {
      const key = decisionKey(chain, mint);
      const hit = decisionCache.get(key);
      if (!hit?.rows.length || source === "4h") decisionCache.set(key, { at, rows: four.slice(-FRAME_BARS) });
    }
  }
}

function cachedRows(mint: string, chain: ChainId, frame: Frame): Candle[] | null {
  if (frame === "4h") {
    const decision = cachedDecisionChart(mint, chain);
    if (decision?.length) return decision;
  }
  const hit = frameCache.get(frameKey(chain, mint, frame));
  return hit?.rows.length ? hit.rows : null;
}

/** Native bars, or a longer frame rolled up from a shorter series already in memory. */
export function cachedFrameChart(mint: string, chain: ChainId, frame: Frame): Candle[] | null {
  const direct = cachedRows(mint, chain, frame);
  if (direct?.length) return direct;
  if (frame === "15m") return derivedFrames(cachedRows(mint, chain, "5m") ?? [], "5m")["15m"] ?? null;
  if (frame === "1h") {
    const from15 = derivedFrames(cachedRows(mint, chain, "15m") ?? [], "15m")["1h"];
    if (from15?.length) return from15;
    return derivedFrames(cachedRows(mint, chain, "5m") ?? [], "5m")["1h"] ?? null;
  }
  if (frame === "4h") {
    const from1 = derivedFrames(cachedRows(mint, chain, "1h") ?? [], "1h")["4h"];
    if (from1 && enoughFrameBars("4h", from1.length)) return from1;
    const from15 = derivedFrames(cachedRows(mint, chain, "15m") ?? [], "15m")["4h"];
    if (from15 && enoughFrameBars("4h", from15.length)) return from15;
  }
  return null;
}

async function readFrameSource(mint: string, chain: ChainId, source: Frame): Promise<void> {
  if (chain === "cronos") {
    const pool = bookPools(chain).find((row) => sameMint(row.mint, mint))?.pool;
    if (!pool) return;
    const network = geckoNetwork(chain);
    const read = source === "15m" || source === "4h" ? readOhlcvDirect : readOhlcv;
    let rows = await read(geckoFrameUrl(network, pool, "pools", source));
    if (!rows.length) rows = await read(geckoFrameUrl(network, mint, "tokens", source)).catch(() => rows);
    if (!rows.length) throw new Error("empty");
    rememberFrames(chain, mint, source, rows);
    return;
  }
  const json = await fetchJson<{ candles?: unknown }>(jupiterChartUrl(mint, Date.now(), FRAME_BARS, jupiterInterval(source)), {
    timeoutMs: 8_000,
    retries: 1,
  });
  const rows = parseJupiterCandles(json.candles);
  if (!rows.length) throw new Error("empty");
  rememberFrames(chain, mint, source, rows);
}

function geckoWaitMs(): number {
  return Math.max(0, geckoNotBefore - Date.now());
}

/** One native read fills every longer frame. An empty book waits for the feed instead of giving up. */
export async function loadFrameChart(mint: string, chain: ChainId, frame: Frame): Promise<Candle[]> {
  const source = sourceFrame(chain, frame);
  const have = cachedFrameChart(mint, chain, frame);
  const sourceHit = frameCache.get(frameKey(chain, mint, source)) ?? (source === "4h" ? decisionCache.get(decisionKey(chain, mint)) : undefined);
  const ttl = FRAME_REFRESH_MS[source] * (chain === "cronos" ? 1.4 : 1);
  if (have && enoughFrameBars(frame, have.length) && sourceHit && Date.now() - sourceHit.at < ttl) return have;
  const key = frameKey(chain, mint, source);
  const missedAt = frameMiss.get(key);
  const missCool = have?.length ? CANDLE_COOL_MS : 2_000;
  if (missedAt && Date.now() - missedAt < missCool) {
    if (have && enoughFrameBars(frame, have.length)) return have;
    await sleep(missCool - (Date.now() - missedAt));
    const retry = cachedFrameChart(mint, chain, frame);
    if (retry && enoughFrameBars(frame, retry.length)) return retry;
  }
  if (chain === "cronos") {
    const wait = geckoWaitMs();
    if (wait > 0) {
      if (have && enoughFrameBars(frame, have.length)) return have;
      await sleep(Math.min(wait, 8_000));
      const after = cachedFrameChart(mint, chain, frame);
      if (after && enoughFrameBars(frame, after.length)) return after;
    }
  }
  let run = frameInflight.get(key);
  if (!run) {
    run = readFrameSource(mint, chain, source)
      .then(() => {
        frameMiss.delete(key);
      })
      .catch(() => {
        frameMiss.set(key, Date.now());
      })
      .finally(() => {
        if (frameInflight.get(key) === run) frameInflight.delete(key);
      });
    frameInflight.set(key, run);
  }
  await run;
  return cachedFrameChart(mint, chain, frame) ?? have ?? [];
}

/** 5-minute on load. 15-minute fills the 1-hour. Solana still reads a native 4-hour when the roll-up is thin. */
export async function loadFrameCharts(mint: string, chain: ChainId): Promise<Record<Frame, Candle[]>> {
  await loadFrameChart(mint, chain, "5m").catch(() => []);
  await loadFrameChart(mint, chain, "15m").catch(() => []);
  const four = cachedFrameChart(mint, chain, "4h");
  if (!four || !enoughFrameBars("4h", four.length)) await loadFrameChart(mint, chain, "4h").catch(() => []);
  return {
    "5m": cachedFrameChart(mint, chain, "5m") ?? [],
    "15m": cachedFrameChart(mint, chain, "15m") ?? [],
    "1h": cachedFrameChart(mint, chain, "1h") ?? [],
    "4h": cachedFrameChart(mint, chain, "4h") ?? [],
  };
}

const WARM_FRAMES: Frame[] = ["5m", "15m", "4h"];

/** Keep the 5-minute, 15-minute, and 4-hour charts warm. The 1-hour is rolled up from the 15-minute. */
export function requestFrameCharts(mints: string[], chain: ChainId, extra: Frame[] = []): void {
  const want = new Set<Frame>([...WARM_FRAMES, ...extra]);
  for (const mint of mints) {
    if (!mint) continue;
    for (const frame of want) void loadFrameChart(mint, chain, frame);
  }
}

/** Login and refresh start here. Native 5-minute and 15-minute per coin, plus Solana's 4-hour when needed. */
export function prefetchFrameCharts(chain: ChainId): Promise<void> {
  const mints = bookMints(chain);
  return Promise.all(mints.map((mint) => loadFrameCharts(mint, chain).catch(() => undefined))).then(() => undefined);
}

/** Pull a native 4-hour chart for every tradable pool. Does not replace the 1-minute cache signals use. */
export function requestBookCharts(pools: string[], chain: ChainId): void {
  const missing: { pool: string; chain: ChainId }[] = [];
  const refresh: { pool: string; chain: ChainId }[] = [];
  for (const pool of pools) {
    if (!pool || chartQueue.some((job) => job.pool === pool && job.chain === chain)) continue;
    const at = chartFetchedAt(pool);
    if (at !== null && Date.now() - at < CHART_CANDLE_MS) continue;
    const missed = chartMiss.get(pool);
    if (missed && Date.now() - missed < CANDLE_COOL_MS && !cachedChart(pool)?.length) continue;
    const job = { pool, chain };
    if (cachedChart(pool)?.length) refresh.push(job);
    else missing.push(job);
  }
  chartQueue.unshift(...missing);
  chartQueue.push(...refresh);
  if (drainingCharts) return;
  drainingCharts = true;
  void drainCharts();
}

async function drainCharts(): Promise<void> {
  try {
    while (chartQueue.length) {
      const job = chartQueue.shift();
      if (!job) break;
      const at = chartFetchedAt(job.pool);
      if (at !== null && Date.now() - at < CHART_CANDLE_MS) continue;
      await loadChart(job.pool, job.chain);
      await sleep(250);
    }
  } finally {
    drainingCharts = false;
    if (chartQueue.length) requestBookCharts([], "solana");
  }
}

async function loadMarketOnce(chain: ChainId): Promise<{
  candidates: TokenCandidate[];
  regime: MarketRegime;
  scanned: number;
}> {
  const chartsReady = prefetchFrameCharts(chain);
  const tapesPromise: Promise<Map<string, JupiterTape>> =
    chain === "solana" ? loadJupiterTapes(bookMints(chain)).catch(() => new Map()) : Promise.resolve(new Map());
  const regimePromise = fetchRegime(chain);
  const lastRows = [...markets[chain].lastBook.values()];
  const lastComplete = bookComplete(lastRows, chain);
  const skipGecko = geckoIsCooling() && (chain === "solana" || lastComplete);
  const watch = skipGecko ? lastRows : await watchlistPools(chain).catch(() => [] as TokenCandidate[]);
  let merged = mergeCandidates([watch.length ? watch : lastRows]).filter((candidate) => isActiveBook(candidate.mint, chain));
  merged = fillActiveBook(merged, chain);
  if (!bookComplete(merged, chain) && !geckoIsCooling()) {
    for (const mint of bookMints(chain)) {
      if (merged.some((candidate) => sameMint(candidate.mint, mint))) continue;
      const meta = watchMeta(mint, chain);
      const pin = bookPools(chain).find((row) => sameMint(row.mint, mint))?.pool;
      if (!meta || !pin) continue;
      await sleep(350);
      const row = await pinnedPool(mint, meta.symbol, pin, chain);
      if (row) merged.push(row);
    }
    merged = fillActiveBook(merged, chain);
  }
  if (!bookComplete(merged, chain)) {
    merged = fillActiveBook(mergeCandidates([merged, skeletonBook(chain)]), chain);
  }
  const candleRows = uniqueBy(
    merged.filter((candidate) => candidate.poolAddress),
    (candidate) => candidate.mint,
  );
  const pinnedPools = new Set(bookPools(chain).map((row) => row.pool));
  requestBookCandles(
    candleRows.map((candidate) => candidate.poolAddress),
    chain,
    pinnedPools,
  );
  const [regime, crossed, tapes] = await Promise.all([
    regimePromise,
    chain === "solana"
      ? crossCheck(merged).catch(() => ({ candidates: merged, yields: [] as YieldQuote[] }))
      : Promise.resolve({ candidates: merged, yields: [] as YieldQuote[] }),
    tapesPromise,
    chartsReady.catch(() => undefined),
  ]);
  let candidates = fillActiveBook(
    crossed.candidates.map((candidate) => withCandleTape(candidate, cachedOhlcv(candidate.poolAddress))),
    chain,
  );
  if (chain === "solana") {
    candidates = candidates.map((candidate) => applyJupiterTape(candidate, tapes.get(candidate.mint) ?? null));
  }
  const stamped = withYields(regime, crossed.yields);
  if (bookComplete(candidates, chain)) markets[chain].cache = { at: Date.now(), candidates, regime: stamped };
  return { candidates, regime: stamped, scanned: candidates.length };
}

function withYields(regime: MarketRegime, yields: YieldQuote[]): MarketRegime {
  if (!yields.length) return { ...regime, yields };
  const line = `Live APY: ${yields.map((y) => `${y.label} ${y.apyPct.toFixed(2)}% (${y.source})`).join("; ")}.`;
  return { ...regime, yields, overview: `${regime.overview} ${line}` };
}

export function invalidateMarketCache(chain?: ChainId): void {
  if (!chain) {
    markets.solana.cache = null;
    markets.cronos.cache = null;
    return;
  }
  markets[chain].cache = null;
}
