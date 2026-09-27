import type { ChainId } from "@/lib/chain";
import { sameMint } from "@/lib/chain";
import type { Candle, FlowWindow, MarketRegime, Timeframe, TokenCandidate } from "@/lib/types";
import { fetchJson, hoursSince, num, nullableNum, sleep, uniqueBy } from "@/lib/utils";
import { loadJupiterPopular } from "./jupiterPopular";
import { liveMajors } from "./marks";
import { crossCheck, type YieldQuote } from "./quotes";
import { venueForDex } from "./venues";
import { CANDLE_COOL_MS, CORE_CANDLE_MS, mintsToFetch, POPULAR_CANDLE_MS, poolsToCandle } from "./ohlcvPlan";
import { pushTapeMark, withCandleTape } from "./tape";
import {
  bookMints,
  bookPools,
  bookTokens,
  classifySector,
  coreBookMints,
  geckoNetwork,
  isActiveBook,
  notePopular,
  isQuote,
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

/** One GeckoTerminal call at a time. A 429 pauses the whole book so candles are not burned. */
function paceGecko<T>(task: () => Promise<T>): Promise<T> {
  const run = geckoTail.then(async () => {
    const wait = geckoNotBefore - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("429")) geckoNotBefore = Date.now() + GECKO_COOL_MS;
      throw error;
    } finally {
      geckoNotBefore = Math.max(geckoNotBefore, Date.now() + GECKO_GAP_MS);
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

async function readOhlcv(url: string): Promise<Candle[]> {
  const json = await paceGecko(() =>
    fetchJson<{
      data?: { attributes?: { ohlcv_list?: [number, number, number, number, number, number][] } };
    }>(url, { timeoutMs: 8_000, retries: 0 }),
  );
  const list = json.data?.attributes?.ohlcv_list ?? [];
  return list
    .map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }))
    .sort((a, b) => a.time - b.time);
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

async function fetchRegime(): Promise<MarketRegime> {
  const [prices, global, fng, chains, dexs] = await Promise.allSettled([
    fetchJson<CgSimple>(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true",
      REGIME_FEED,
    ),
    fetchJson<CgGlobal>("https://api.coingecko.com/api/v3/global", REGIME_FEED),
    fetchJson<{ data: { value: string; value_classification: string }[] }>("https://api.alternative.me/fng/?limit=1", REGIME_FEED),
    fetchJson<{ name: string; gecko_id?: string; tvl: number }[]>("https://api.llama.fi/v2/chains", REGIME_FEED),
    fetchJson<{ total24h?: number; change_1d?: number }>(
      "https://api.llama.fi/overview/dexs/solana?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true",
      REGIME_FEED,
    ),
  ]);

  const px = prices.status === "fulfilled" ? prices.value : null;
  const needFallback = !nullableNum(px?.bitcoin?.usd) || !nullableNum(px?.ethereum?.usd) || !nullableNum(px?.solana?.usd);
  const fallback = needFallback ? await liveMajors().catch(() => null) : null;
  const g = global.status === "fulfilled" ? global.value.data : null;
  const fear = fng.status === "fulfilled" ? fng.value.data?.[0] : null;
  const chainList = chains.status === "fulfilled" ? chains.value : [];
  const solChain = chainList.find((c) => c.name === "Solana" || c.gecko_id === "solana");
  const dex = dexs.status === "fulfilled" ? dexs.value : null;

  const btcPx = nullableNum(px?.bitcoin?.usd) ?? fallback?.btc.price ?? null;
  const ethPx = nullableNum(px?.ethereum?.usd) ?? fallback?.eth.price ?? null;
  const solPx = nullableNum(px?.solana?.usd) ?? fallback?.sol.price ?? null;
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
    price: solPx ?? 0,
    change24h: solPx === null ? 0 : num(px?.solana?.usd_24h_change ?? fallback?.sol.change24h),
    marketCap: num(px?.solana?.usd_market_cap),
    volume24h: num(px?.solana?.usd_24h_vol),
  };

  const fearValue = fear ? num(fear.value) : null;
  const btcDom = nullableNum(g?.market_cap_percentage?.btc);
  const solVsBtc = sol.change24h - btc.change24h;
  const riskOn =
    Boolean(btcPx && solPx) &&
    btc.change24h > 0.4 &&
    sol.change24h > 0 &&
    (fearValue === null || fearValue >= 45) &&
    (dex?.change_1d === undefined || dex.change_1d > -8);
  const defensive =
    Boolean(btcPx || solPx) &&
    (btc.change24h < -2 || (fearValue !== null && fearValue < 30) || sol.change24h < -5);
  const stance: MarketRegime["stance"] = !btcPx && !solPx ? "mixed" : defensive ? "defensive" : riskOn ? "risk-on" : "mixed";

  const crowded: string[] = [];
  const overlooked: string[] = [];
  if (fearValue !== null && fearValue >= 70) crowded.push("High-beta memes (Fear & Greed in greed)");
  else if (fearValue !== null) overlooked.push("Selective high-beta Solana names while sentiment is not euphoric");
  if (btcPx && solPx && solVsBtc > 2) crowded.push("SOL beta / ecosystem rotation vs BTC");
  else if (btcPx && solPx && solVsBtc < -2) overlooked.push("Solana beta vs BTC (SOL underperforming on the day)");
  if (dex?.change_1d !== undefined && dex.change_1d > 15) crowded.push("Solana DEX volume chase");
  else if (dex?.change_1d !== undefined) overlooked.push("Spot DEX flow that is not exploding day-over-day");
  crowded.push("Paid Dexscreener boosts / launchpad tape");
  overlooked.push("Fee-switch / LST / perps venues with measurable usage");

  const stanceWhy =
    !btcPx && !solPx
      ? "BTC/SOL marks are missing this cycle. Stance is withheld — no fabricated tape."
      : stance === "defensive"
        ? "BTC or SOL is selling off, or sentiment is fearful — size down and demand cleaner setups."
        : stance === "risk-on"
          ? "BTC and SOL are green with non-panicked sentiment — short-term longs have a tailwind."
          : "Tape is mixed. Prefer liquid names, tight risk, and fade only extreme extensions.";

  const overview = [
    `BTC ${btc.price ? `$${btc.price.toLocaleString()} (${btc.change24h.toFixed(2)}%)` : "n/a"}, ETH ${eth.price ? `$${eth.price.toLocaleString()} (${eth.change24h.toFixed(2)}%)` : "n/a"}, SOL ${sol.price ? `$${sol.price.toFixed(2)} (${sol.change24h.toFixed(2)}%)` : "n/a"}.`,
    btcDom !== null ? `BTC dominance ${btcDom.toFixed(1)}%.` : "BTC dominance unavailable.",
    fear ? `Fear & Greed ${fear.value} (${fear.value_classification}).` : "Fear & Greed unavailable.",
    solChain ? `Solana DeFi TVL $${(solChain.tvl / 1e9).toFixed(2)}B.` : "Solana TVL unavailable.",
    dex?.total24h
      ? `Solana DEX volume 24h $${(dex.total24h / 1e9).toFixed(2)}B (${dex.change_1d !== undefined ? `${dex.change_1d.toFixed(1)}% d/d` : "d/d n/a"}).`
      : "Solana DEX volume unavailable.",
    stanceWhy,
  ].join(" ");

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
    solanaTvl: solChain?.tvl ?? null,
    solanaDexVolume24h: dex?.total24h ?? null,
    solanaDexVolumeChange1d: dex?.change_1d ?? null,
    stance,
    stanceWhy,
    crowded,
    overlooked,
    overview,
    narratives:
      stance === "risk-on"
        ? ["SOL beta", "DEX flow", "Selective memes only with liquidity"]
        : stance === "defensive"
          ? ["Capital preservation", "SOL/USDC only", "Avoid illiquid launches"]
          : ["Liquid majors", "Mean-reversion fades", "Research over tape-chasing"],
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

async function loadMarketOnce(chain: ChainId): Promise<{
  candidates: TokenCandidate[];
  regime: MarketRegime;
  scanned: number;
}> {
  if (chain === "solana") {
    const popular = await loadJupiterPopular().catch(() => null);
    if (popular) notePopular(popular);
  }
  const watch = await watchlistPools(chain).catch(() => [] as TokenCandidate[]);
  const regimePromise = fetchRegime();
  let merged = mergeCandidates([watch]).filter((candidate) => isActiveBook(candidate.mint, chain));
  if (!bookComplete(merged, chain)) {
    for (const mint of bookMints(chain)) {
      if (merged.some((candidate) => sameMint(candidate.mint, mint))) continue;
      const meta = watchMeta(mint, chain);
      const pin = bookPools(chain).find((row) => sameMint(row.mint, mint))?.pool;
      if (!meta || !pin) continue;
      await sleep(350);
      const row = await pinnedPool(mint, meta.symbol, pin, chain);
      if (row) merged.push(row);
    }
  }
  merged = fillActiveBook(merged, chain);
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
  const [regime, crossed] = await Promise.all([
    regimePromise,
    crossCheck(merged).catch(() => ({ candidates: merged, yields: [] as YieldQuote[] })),
  ]);
  const candidates = fillActiveBook(
    crossed.candidates.map((candidate) => withCandleTape(candidate, cachedOhlcv(candidate.poolAddress))),
    chain,
  );
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
