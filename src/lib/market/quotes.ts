import type { TokenCandidate } from "@/lib/types";
import { fetchJson, nullableNum, num, uniqueBy } from "@/lib/utils";
import { JITO_SOL_MINT, JLP_MINT, SOL_MINT, USDC_MINT } from "./universe";

/** Quotes inside this band of the median are treated as the same mark. */
export const PRICE_BAND = 0.06;

export interface PriceQuote {
  source: string;
  price: number;
}

export interface QuoteBlend {
  price: number | null;
  sources: string[];
  agreement: "agree" | "thin" | "split";
}

export interface YieldPrint {
  mint: string;
  label: string;
  apyPct: number;
  source: string;
}

export interface YieldQuote {
  label: string;
  apyPct: number;
  source: string;
}

export function median(values: number[]): number {
  const sorted = [...values].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Accept a fraction (0.0498), a percent (8.87), or basis points (442).
 * Returns a percent, or null when the figure is missing, zero, or not a durable yield.
 */
export function normalizeRate(raw: number): number | null {
  if (!Number.isFinite(raw) || raw <= 0) return null;
  let pct: number;
  if (raw < 1) pct = raw * 100;
  else if (raw <= 40) pct = raw;
  else if (raw <= 4_000) pct = raw / 100;
  else return null;
  if (!Number.isFinite(pct) || pct <= 0 || pct > 40) return null;
  return pct;
}

export function blendQuotes(quotes: PriceQuote[], band = PRICE_BAND): QuoteBlend {
  const clean = quotes.filter((q) => Number.isFinite(q.price) && q.price > 0 && q.source);
  if (!clean.length) return { price: null, sources: [], agreement: "thin" };
  if (clean.length === 1) {
    return { price: clean[0].price, sources: [clean[0].source], agreement: "thin" };
  }
  const mid = median(clean.map((q) => q.price));
  const inliers = clean.filter((q) => mid > 0 && Math.abs(q.price - mid) / mid <= band);
  if (inliers.length >= 2) {
    return {
      price: median(inliers.map((q) => q.price)),
      sources: uniqueBy(inliers, (q) => q.source).map((q) => q.source),
      agreement: "agree",
    };
  }
  const anchor = clean.find((q) => q.source.startsWith("geckoterminal"));
  return {
    price: anchor ? anchor.price : null,
    sources: uniqueBy(clean, (q) => q.source).map((q) => q.source),
    agreement: "split",
  };
}

export function markIsTradable(agreement: TokenCandidate["priceAgreement"]): boolean {
  return agreement !== "split";
}

export function applyQuoteBlend(candidate: TokenCandidate, quotes: PriceQuote[]): TokenCandidate {
  const blended = blendQuotes(quotes);
  const sources = uniqueBy([...candidate.sources, ...blended.sources], (s) => s);
  if (blended.price === null) {
    return {
      ...candidate,
      sources,
      priceAgreement: blended.agreement === "split" ? "split" : (candidate.priceAgreement ?? "thin"),
      apyPct: candidate.apyPct ?? null,
      apySources: candidate.apySources ?? [],
    };
  }
  return {
    ...candidate,
    priceUsd: blended.price,
    sources,
    priceAgreement: blended.agreement,
    apyPct: candidate.apyPct ?? null,
    apySources: candidate.apySources ?? [],
  };
}

/** Attach yield only when the print's mint is this token. A SOL-backed LST must not stamp SOL. */
export function attachYields(candidates: TokenCandidate[], prints: YieldPrint[]): TokenCandidate[] {
  const byMint = new Map<string, YieldPrint[]>();
  for (const print of prints) {
    const apy = normalizeRate(print.apyPct);
    if (!print.mint || apy === null) continue;
    const list = byMint.get(print.mint) ?? [];
    list.push({ ...print, apyPct: apy });
    byMint.set(print.mint, list);
  }
  return candidates.map((c) => {
    const hits = byMint.get(c.mint) ?? [];
    if (!hits.length) {
      return { ...c, apyPct: c.apyPct ?? null, apySources: c.apySources ?? [] };
    }
    const mid = median(hits.map((h) => h.apyPct));
    const cluster = hits.filter((h) => Math.abs(h.apyPct - mid) <= 1.5);
    const listed = cluster.length ? cluster : hits;
    const apy = cluster.length ? median(cluster.map((h) => h.apyPct)) : Math.min(...hits.map((h) => h.apyPct));
    return {
      ...c,
      apyPct: Number(apy.toFixed(2)),
      apySources: uniqueBy(listed, (h) => h.source).map((h) => h.source),
    };
  });
}

export function mintsToCrossCheck(
  candidates: Pick<TokenCandidate, "mint" | "watchlist" | "liquidityUsd">[],
  limit = 30,
): string[] {
  const ranked = [...candidates].sort((a, b) => {
    if (a.watchlist !== b.watchlist) return a.watchlist ? -1 : 1;
    return b.liquidityUsd - a.liquidityUsd;
  });
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of ranked) {
    if (!c.mint || seen.has(c.mint)) continue;
    seen.add(c.mint);
    out.push(c.mint);
    if (out.length >= limit) break;
  }
  return out;
}

interface DexPair {
  priceUsd?: string;
  liquidity?: { usd?: number };
  baseToken?: { address?: string };
}

const FEED_MS = 2_500;

function deadline<T>(work: Promise<T>, fallback: T, ms = FEED_MS): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

async function jupiterPrices(mints: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!mints.length) return out;
  const json = await fetchJson<Record<string, { usdPrice?: number }>>(
    `https://lite-api.jup.ag/price/v3?ids=${mints.join(",")}`,
    { timeoutMs: FEED_MS, retries: 1 },
  );
  for (const mint of mints) {
    const price = nullableNum(json[mint]?.usdPrice);
    if (price && price > 0) out.set(mint, price);
  }
  return out;
}

async function dexPrices(mints: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!mints.length) return out;
  const json = await fetchJson<DexPair[] | { pairs?: DexPair[] }>(
    `https://api.dexscreener.com/tokens/v1/solana/${mints.join(",")}`,
    { timeoutMs: FEED_MS, retries: 1 },
  );
  const pairs = Array.isArray(json) ? json : (json.pairs ?? []);
  const best = new Map<string, { price: number; liq: number }>();
  for (const pair of pairs) {
    const mint = pair.baseToken?.address ?? "";
    const price = nullableNum(pair.priceUsd);
    if (!mint || !price || price <= 0) continue;
    const liq = num(pair.liquidity?.usd);
    const prev = best.get(mint);
    if (!prev || liq >= prev.liq) best.set(mint, { price, liq });
  }
  for (const [mint, row] of best) out.set(mint, row.price);
  return out;
}

async function llamaPrices(mints: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!mints.length) return out;
  const json = await fetchJson<{
    coins?: Record<string, { price?: number; confidence?: number; timestamp?: number }>;
  }>(`https://coins.llama.fi/prices/current/${mints.map((m) => `solana:${m}`).join(",")}`, {
    timeoutMs: FEED_MS,
    retries: 1,
  });
  const now = Date.now();
  for (const mint of mints) {
    const coin = json.coins?.[`solana:${mint}`];
    const price = nullableNum(coin?.price);
    const confidence = coin?.confidence;
    if (!price || price <= 0) continue;
    if (confidence !== undefined && confidence < 0.5) continue;
    const ts = num(coin?.timestamp);
    if (ts > 0) {
      const ms = ts > 1e12 ? ts : ts * 1000;
      if (now - ms > 6 * 3_600_000) continue;
    }
    out.set(mint, price);
  }
  return out;
}

async function jitoYield(): Promise<YieldPrint | null> {
  const json = await fetchJson<{ apy?: { data?: number; date?: string }[] }>(
    "https://kobe.mainnet.jito.network/api/v1/stake_pool_stats",
    { timeoutMs: FEED_MS, retries: 1 },
  );
  const latest = [...(json.apy ?? [])]
    .filter((row) => normalizeRate(num(row.data)) !== null)
    .sort((a, b) => Date.parse(b.date ?? "") - Date.parse(a.date ?? ""))[0];
  const apy = latest ? normalizeRate(num(latest.data)) : null;
  if (!latest || apy === null) return null;
  return { mint: JITO_SOL_MINT, label: "JitoSOL", apyPct: apy, source: "jito:stake-pool" };
}

async function jlpFeed(): Promise<{ price: number | null; yield: YieldPrint | null }> {
  const json = await fetchJson<{ jlpPriceUsdFormatted?: string; jlpApyPct?: string }>(
    "https://perps-api.jup.ag/v1/jlp-info",
    { timeoutMs: FEED_MS, retries: 1 },
  );
  const price = nullableNum(json.jlpPriceUsdFormatted);
  const apy = normalizeRate(num(json.jlpApyPct));
  return {
    price: price && price > 0 && price < 100 ? price : null,
    yield: apy === null ? null : { mint: JLP_MINT, label: "JLP", apyPct: apy, source: "jupiter:jlp" },
  };
}

async function lendYields(): Promise<YieldPrint[]> {
  const json = await fetchJson<
    { address?: string; assetAddress?: string; symbol?: string; totalRate?: number | string }[]
  >("https://api.jup.ag/lend/v1/earn/tokens", { timeoutMs: FEED_MS, retries: 1 });
  const rows = Array.isArray(json) ? json : [];
  const out: YieldPrint[] = [];
  for (const row of rows) {
    const apy = normalizeRate(num(row.totalRate));
    if (!row.address || apy === null) continue;
    let label = row.symbol || "Lend";
    if (row.assetAddress === USDC_MINT) label = "USDC lend";
    else if (row.assetAddress === SOL_MINT) label = "SOL lend";
    else continue;
    out.push({ mint: row.address, label, apyPct: apy, source: "jupiter:lend" });
  }
  return out;
}

function quotesFor(
  candidate: TokenCandidate,
  jup: Map<string, number>,
  dex: Map<string, number>,
  llama: Map<string, number>,
  jlpPrice: number | null,
): PriceQuote[] {
  const quotes: PriceQuote[] = [];
  if (candidate.priceUsd > 0) quotes.push({ source: "geckoterminal:price", price: candidate.priceUsd });
  const j = jup.get(candidate.mint);
  if (j) quotes.push({ source: "jupiter:price", price: j });
  const d = dex.get(candidate.mint);
  if (d) quotes.push({ source: "dexscreener:price", price: d });
  const l = llama.get(candidate.mint);
  if (l) quotes.push({ source: "defillama:price", price: l });
  if (candidate.mint === JLP_MINT && jlpPrice) quotes.push({ source: "jupiter:jlp-price", price: jlpPrice });
  return quotes;
}

export async function crossCheck(
  candidates: TokenCandidate[],
): Promise<{ candidates: TokenCandidate[]; yields: YieldQuote[] }> {
  const mints = mintsToCrossCheck(candidates);
  const [jupR, dexR, llamaR, jitoR, jlpR, lendR] = await Promise.allSettled([
    deadline(jupiterPrices(mints), new Map<string, number>()),
    deadline(dexPrices(mints), new Map<string, number>()),
    deadline(llamaPrices(mints), new Map<string, number>()),
    deadline(jitoYield(), null),
    deadline(jlpFeed(), { price: null, yield: null }),
    deadline(lendYields(), [] as YieldPrint[]),
  ]);
  const jup = jupR.status === "fulfilled" ? jupR.value : new Map<string, number>();
  const dex = dexR.status === "fulfilled" ? dexR.value : new Map<string, number>();
  const llama = llamaR.status === "fulfilled" ? llamaR.value : new Map<string, number>();
  const jlp = jlpR.status === "fulfilled" ? jlpR.value : { price: null, yield: null };
  const prints: YieldPrint[] = [];
  if (jitoR.status === "fulfilled" && jitoR.value) prints.push(jitoR.value);
  if (jlp.yield) prints.push(jlp.yield);
  if (lendR.status === "fulfilled") prints.push(...lendR.value);

  const selected = new Set(mints);
  const blended = candidates.map((c) =>
    selected.has(c.mint) ? applyQuoteBlend(c, quotesFor(c, jup, dex, llama, jlp.price)) : c,
  );
  const withYield = attachYields(blended, prints);
  const yields: YieldQuote[] = [];
  for (const label of ["JitoSOL", "JLP", "USDC lend", "SOL lend"]) {
    const hit = prints.find((p) => p.label === label && normalizeRate(p.apyPct) !== null);
    if (!hit) continue;
    yields.push({ label, apyPct: Number(normalizeRate(hit.apyPct)!.toFixed(2)), source: hit.source });
  }
  return { candidates: withYield, yields };
}
