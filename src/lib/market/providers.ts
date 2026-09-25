import type { Candle, FlowWindow, MarketRegime, Timeframe, TokenCandidate } from "@/lib/types";
import { fetchJson, hoursSince, mapPool, num, nullableNum, sleep, uniqueBy } from "@/lib/utils";
import { liveMajors } from "./marks";
import { crossCheck, type YieldQuote } from "./quotes";
import { venueForDex } from "./venues";
import { classifySector, isActiveBook, isQuote, isStable, SOL_MINT, SOL_USDC_POOLS, watchMeta, WATCHLIST } from "./universe";

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

let cache:
  | {
      at: number;
      candidates: TokenCandidate[];
      regime: MarketRegime;
    }
  | null = null;

const CACHE_MS = 120_000;

function mintFromGtId(id: string | undefined): string {
  if (!id) return "";
  return id.startsWith("solana_") ? id.slice("solana_".length) : id;
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

function toCandidate(pool: GtPool, tokens: Map<string, GtToken>, source: string): TokenCandidate | null {
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

  const watch = watchMeta(mint);
  const name = watch?.name || base?.attributes.name || symbol;
  const created = pool.attributes.pool_created_at;

  return {
    id: mint,
    chain: "solana",
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

async function gtPools(path: string, source: string): Promise<TokenCandidate[]> {
  const url = `https://api.geckoterminal.com/api/v2/${path}${path.includes("?") ? "&" : "?"}include=base_token,quote_token`;
  const json = await fetchJson<{ data: GtPool[]; included?: GtToken[] }>(url, { timeoutMs: 8_000, retries: 1 });
  const tokens = tokenMap(json.included);
  return json.data.map((p) => toCandidate(p, tokens, source)).filter((x): x is TokenCandidate => Boolean(x));
}

async function watchlistPools(): Promise<TokenCandidate[]> {
  const book = WATCHLIST.filter((token) => isActiveBook(token.mint));
  const results = await mapPool(book, 3, async (t) => {
    try {
      const pools = await gtPools(
        `networks/solana/tokens/${t.mint}/pools?page=1`,
        `geckoterminal:token:${t.symbol}`,
      );
      return pools
        .filter((p) => p.mint === t.mint)
        .map((p) => ({ ...p, watchlist: true, symbol: t.symbol, name: t.name, sector: t.sector }));
    } catch {
      return [] as TokenCandidate[];
    }
  });
  const pools = results.flat();
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
const OHLCV_TTL_MS = 3 * 60_000;
const OHLCV_STALE_MS = 20 * 60_000;
const OHLCV_MISS_MS = 45_000;
const OHLCV_GAP_MS = 1_200;
let ohlcvTail: Promise<unknown> = Promise.resolve();
let ohlcvNotBefore = 0;

function enqueueOhlcv<T>(task: () => Promise<T>): Promise<T> {
  const run = ohlcvTail.then(async () => {
    const delay = ohlcvNotBefore - Date.now();
    if (delay > 0) await sleep(delay);
    try {
      return await task();
    } finally {
      ohlcvNotBefore = Date.now() + OHLCV_GAP_MS;
    }
  });
  ohlcvTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function fetchOhlcvOnce(poolAddress: string, timeframe: "minute" | "hour", aggregate: number, limit: number): Promise<Candle[]> {
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}`;
  const json = await fetchJson<{
    data?: { attributes?: { ohlcv_list?: [number, number, number, number, number, number][] } };
  }>(url, { timeoutMs: 10_000, retries: 2 });
  const list = json.data?.attributes?.ohlcv_list ?? [];
  return list
    .map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }))
    .sort((a, b) => a.time - b.time);
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

export async function fetchOhlcv(poolAddress: string, limit = 80): Promise<Candle[]> {
  const hit = ohlcvCache.get(poolAddress);
  if (hit && Date.now() - hit.at < OHLCV_TTL_MS && hit.rows.length) return hit.rows;
  const missedAt = ohlcvMiss.get(poolAddress);
  if (missedAt && Date.now() - missedAt < OHLCV_MISS_MS) {
    const stale = staleCandles(poolAddress);
    if (stale) return stale;
    throw new Error(`429 cooling down for ${poolAddress}`);
  }
  try {
    const rows = await enqueueOhlcv(() => fetchOhlcvOnce(poolAddress, "minute", 5, Math.min(limit, 70)));
    if (rows.length) {
      ohlcvCache.set(poolAddress, { at: Date.now(), rows });
      ohlcvMiss.delete(poolAddress);
      return rows;
    }
    const stale = staleCandles(poolAddress);
    if (stale) return stale;
    return rows;
  } catch (error) {
    ohlcvMiss.set(poolAddress, Date.now());
    const stale = staleCandles(poolAddress);
    if (stale) return stale;
    throw error;
  }
}

export async function fetchOhlcvFromPools(poolAddresses: string[], limit = 80): Promise<Candle[]> {
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

const REGIME_FEED = { timeoutMs: 6_000, retries: 1 };

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

let marketInflight: Promise<{ candidates: TokenCandidate[]; regime: MarketRegime; scanned: number }> | null = null;

export async function loadMarket(force = false): Promise<{
  candidates: TokenCandidate[];
  regime: MarketRegime;
  scanned: number;
}> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return { candidates: cache.candidates, regime: cache.regime, scanned: cache.candidates.length };
  }
  if (!force && marketInflight) return marketInflight;

  const run = loadMarketOnce();
  marketInflight = run;
  void run.finally(() => {
    if (marketInflight === run) marketInflight = null;
  });
  return run;
}

async function loadMarketOnce(): Promise<{
  candidates: TokenCandidate[];
  regime: MarketRegime;
  scanned: number;
}> {
  const [regime, pools] = await Promise.all([
    fetchRegime(),
    (async () => {
      const watch = await watchlistPools().catch(() => [] as TokenCandidate[]);
      return { watch };
    })(),
  ]);
  const { watch } = pools;

  const merged = mergeCandidates([watch]).filter((candidate) => isActiveBook(candidate.mint));
  let candidates = merged;
  let yields: YieldQuote[] = [];
  try {
    const crossed = await crossCheck(merged);
    candidates = crossed.candidates;
    yields = crossed.yields;
  } catch {
    candidates = merged;
  }
  const stamped = withYields(regime, yields);
  cache = { at: Date.now(), candidates, regime: stamped };
  return { candidates, regime: stamped, scanned: candidates.length };
}

function withYields(regime: MarketRegime, yields: YieldQuote[]): MarketRegime {
  if (!yields.length) return { ...regime, yields };
  const line = `Live APY: ${yields.map((y) => `${y.label} ${y.apyPct.toFixed(2)}% (${y.source})`).join("; ")}.`;
  return { ...regime, yields, overview: `${regime.overview} ${line}` };
}

export function invalidateMarketCache(): void {
  cache = null;
}
