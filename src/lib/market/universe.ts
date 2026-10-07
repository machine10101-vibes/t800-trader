import { sameMint, type ChainId } from "@/lib/chain";
import type { Sector } from "@/lib/types";

export interface WatchToken {
  symbol: string;
  name: string;
  mint: string;
  sector: Sector;
  /** Jupiter mark, shown before the pool tape arrives. */
  priceUsd?: number;
  /** Jupiter's graduated pool, so the chart does not wait on a pool search. */
  pool?: string;
  /** Five-minute move from Jupiter, until the candle tape replaces it. */
  change5m?: number;
}

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export const JITO_SOL_MINT = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
export const JLP_MINT = "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4";
export const ZBCN_MINT = "ZBCNpuD7YMXzTHB2fhGkGi78MNsHGLRXUhRewNRm9RU";
export const PUMP_MINT = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";
export const ZEC_MINT = "A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS";
export const RAY_MINT = "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R";

/** Wrapped CRO on Cronos. The desk trades this as CRO. */
export const WCRO_MINT = "0x5c7f8a570d578ed84e63fdfa7b1ee72deae1ae23";
/** USDC on Cronos. Buys spend this. Sells return it. */
export const CRONOS_USDC = "0xc21223249ca28397b4b6541dffaecc539bff0c59";
/** Deep WCRO/USDC pool. GeckoTerminal network id is `cro`. */
export const CRO_POOL = "0xe61db569e231b3f5530168aa2c9d50246525b6d6";
/** Ultra Cat. The liquid pool is ULTCAT/WCRO. */
export const ULTCAT_MINT = "0xbf19931ebf1bc9fb85820aa8f6ba29030a9b9a27";
export const ULTCAT_POOL = "0xe7abe288bca3ee2322f82ac52a2fc44a222cdbfa";
/** Crime Cat. The Sep 21 2026 contract. A later contract with the same ticker is dust. */
export const CRIMECAT_MINT = "0x5b326376d34253fab935d3113698c335c7e61e85";
export const CRIMECAT_POOL = "0x7d5e144ca906f1e1cc93494560b0f1eee9aa8492";
/** Mistery. */
export const MERY_MINT = "0x3b41b27e74dd366ce27cb389dc7877d4e1516d4d";
export const MERY_POOL = "0xa51231984ff01f4933a9fa24e8fd143f18ae6772";
/** Wolfies. The token ticker is PACK. */
export const PACK_MINT = "0x0d0b4a6fc6e7f5635c2ff38de75af2e96d6d6804";
export const PACK_POOL = "0x82234ae6d2df79e4d22ce05c63a703f3dbc32520";

/** The only Solana names this desk trades. Jupiter's most-traded list is not on the book. */
export const ACTIVE_BOOK = [SOL_MINT, ZBCN_MINT, PUMP_MINT, ZEC_MINT, RAY_MINT] as const;

/** Kept so a stale popular payload cannot widen the book. */
let popularBook: WatchToken[] = [];

export function notePopular(tokens: readonly WatchToken[]): void {
  const seen = new Set<string>(ACTIVE_BOOK);
  const next: WatchToken[] = [];
  for (const token of tokens) {
    if (!token.mint || seen.has(token.mint)) continue;
    seen.add(token.mint);
    next.push(token);
  }
  popularBook = next;
}

export function popularTokens(): WatchToken[] {
  return popularBook;
}

const CRONOS_BOOK: WatchToken[] = [
  { symbol: "CRO", name: "Cronos", mint: WCRO_MINT, sector: "L1", pool: CRO_POOL },
  { symbol: "ULTCAT", name: "Ultra Cat", mint: ULTCAT_MINT, sector: "Meme", pool: ULTCAT_POOL },
  { symbol: "CRIMECAT", name: "Crime Cat", mint: CRIMECAT_MINT, sector: "Meme", pool: CRIMECAT_POOL },
  { symbol: "MERY", name: "Mistery", mint: MERY_MINT, sector: "Meme", pool: MERY_POOL },
  { symbol: "PACK", name: "Wolfies", mint: PACK_MINT, sector: "Meme", pool: PACK_POOL },
];

export function geckoNetwork(chain: ChainId = "solana"): string {
  return chain === "cronos" ? "cro" : "solana";
}

/** Liquid SOL/USDC pools GeckoTerminal indexes — used when a finalist has no 5m tape. */
export const SOL_USDC_POOLS = [
  "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj",
  "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
];

/**
 * One liquid pool per name. The first pool Jupiter lists for Pump, ZEC, and Ray
 * is a dust pool, and a dust reserve never clears the book screen.
 */
export const BOOK_POOLS: { mint: string; pool: string }[] = [
  { mint: SOL_MINT, pool: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2" },
  { mint: ZBCN_MINT, pool: "FaoZEZFsRS2jJAzg5PXwNjDdA1hDAjDGAkDf4xRfY79w" },
  { mint: PUMP_MINT, pool: "2uF4Xh61rDwxnG9woyxsVQP7zuA6kLFpb3NvnRQeoiSd" },
  { mint: ZEC_MINT, pool: "GTHKH8s82ZR8GTSFZ1dUu6wfdxhy59wpMShxzG5zjiPm" },
  { mint: RAY_MINT, pool: "2AXXcN6oN9bBT5owwmTH53C7QHUXvhLeu718Kqt8rvY2" },
];

export const WATCHLIST: WatchToken[] = [
  { symbol: "SOL", name: "Solana", mint: SOL_MINT, sector: "L1" },
  { symbol: "JUP", name: "Jupiter", mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", sector: "DEX" },
  { symbol: "JTO", name: "Jito", mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", sector: "LST" },
  { symbol: "JITOSOL", name: "Jito Staked SOL", mint: JITO_SOL_MINT, sector: "LST" },
  { symbol: "RAY", name: "Raydium", mint: RAY_MINT, sector: "DEX" },
  { symbol: "ORCA", name: "Orca", mint: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE", sector: "DEX" },
  { symbol: "PYTH", name: "Pyth", mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", sector: "Oracle" },
  { symbol: "DRIFT", name: "Drift", mint: "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7", sector: "Perps" },
  { symbol: "JLP", name: "Jupiter Perps LP", mint: JLP_MINT, sector: "Perps" },
  { symbol: "MNDE", name: "Marinade", mint: "MNDEFzGvMt87ueuHvVU9VcTQSQB6XND51pVSJD1YJXB", sector: "LST" },
  { symbol: "HNT", name: "Helium", mint: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrE3XEbKcP", sector: "DePIN" },
  { symbol: "RENDER", name: "Render", mint: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof", sector: "DePIN" },
  { symbol: "ZBCN", name: "Zebec Network", mint: ZBCN_MINT, sector: "Payments" },
  { symbol: "PUMP", name: "Pump", mint: PUMP_MINT, sector: "Meme" },
  { symbol: "ZEC", name: "Zcash", mint: ZEC_MINT, sector: "Payments" },
  { symbol: "W", name: "Wormhole", mint: "85VBFQZC9TZkfaptBWtv8W11s6tJy3Dg6ZEr3GUeA6S", sector: "Infra" },
  { symbol: "TNSR", name: "Tensor", mint: "TNSRxcUxoT9xBG3de7PiWmgQhEQ1e6bwS4P8Cdgx31A", sector: "Infra" },
  { symbol: "BONK", name: "Bonk", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", sector: "Meme" },
  { symbol: "WIF", name: "dogwifhat", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", sector: "Meme" },
];

const WATCH_BY_MINT = new Map(WATCHLIST.map((t) => [t.mint, t]));
const WATCH_BY_SYMBOL = new Map(WATCHLIST.map((t) => [t.symbol.toUpperCase(), t]));

const STABLE_SYMS = new Set(["USDC", "USDT", "USD1", "PYUSD", "USDS", "DAI", "FDUSD", "CASH"]);
const QUOTE_SYMS = new Set(["SOL", "WSOL", "USDC", "USDT"]);
const WRAPPED_OR_FOREIGN = new Set([
  "WETH",
  "ETH",
  "WBTC",
  "BTC",
  "CBBTC",
  "TBTC",
  "HBTC",
  "ZEC",
  "WZEC",
  "XMR",
  "LTC",
  "DOGE",
  "SHIB",
]);

export function isForeignOrWrapped(symbol: string, name: string): boolean {
  const sym = symbol.toUpperCase();
  if (WRAPPED_OR_FOREIGN.has(sym)) return true;
  const blob = `${sym} ${name}`.toLowerCase();
  return /\b(wrapped (eth|btc|ether|bitcoin)|weth|wbtc)\b/.test(blob);
}

export function isStable(symbol: string): boolean {
  return STABLE_SYMS.has(symbol.toUpperCase().replace(/\s+/g, ""));
}

export function isQuote(symbol: string): boolean {
  return QUOTE_SYMS.has(symbol.toUpperCase()) || isStable(symbol);
}

export function classifySector(symbol: string, name: string): Sector {
  const known = WATCH_BY_SYMBOL.get(symbol.toUpperCase());
  if (known) return known.sector;
  const blob = `${symbol} ${name}`.toLowerCase();
  if (/(wif|bonk|pepe|doge|meme|cat|dog|trump|elon|inu)/.test(blob)) return "Meme";
  if (/(perp|drift|aevo|gmx|jupiter perps|jlp)/.test(blob)) return "Perps";
  if (/(jito|marinade|sanctum|lst|stake)/.test(blob)) return "LST";
  if (/(raydium|orca|jupiter|meteora|dex|swap)/.test(blob)) return "DEX";
  if (/(pyth|oracle|switchboard)/.test(blob)) return "Oracle";
  if (/(lend|kamino|solend|margin|borrow)/.test(blob)) return "Lending";
  if (/(render|helium|depin|hivemapper|nosana|io.net)/.test(blob)) return "DePIN";
  if (/(bridge|wormhole|layerzero|infra)/.test(blob)) return "Infra";
  if (/(payment|payfi|stripe|usdc)/.test(blob)) return "Payments";
  return "Unknown";
}

export function coreBookMints(chain: ChainId = "solana"): string[] {
  if (chain === "cronos") return CRONOS_BOOK.map((token) => token.mint);
  return [...ACTIVE_BOOK];
}

export function bookTokens(chain: ChainId = "solana"): WatchToken[] {
  if (chain === "cronos") return CRONOS_BOOK;
  return ACTIVE_BOOK.map((mint) => WATCH_BY_MINT.get(mint)).filter((token): token is WatchToken => Boolean(token));
}

export function bookPools(chain: ChainId = "solana"): { mint: string; pool: string }[] {
  if (chain === "cronos") {
    return CRONOS_BOOK.flatMap((token) => (token.pool ? [{ mint: token.mint, pool: token.pool }] : []));
  }
  return BOOK_POOLS;
}

export function bookMints(chain: ChainId = "solana"): string[] {
  return bookTokens(chain).map((token) => token.mint);
}

export function headlineFor(chain: ChainId = "solana"): { symbol: string; label: string }[] {
  if (chain === "cronos") return CRONOS_BOOK.map((token) => ({ symbol: token.symbol, label: token.symbol }));
  const labels: Record<string, string> = { SOL: "SOL", ZBCN: "Zebec", PUMP: "Pump", ZEC: "ZEC", RAY: "Ray" };
  return bookTokens(chain).map((token) => ({ symbol: token.symbol, label: labels[token.symbol] ?? token.symbol }));
}

export function isActiveBook(mint: string, chain: ChainId = "solana"): boolean {
  return bookMints(chain).some((item) => sameMint(item, mint));
}

export function watchMeta(mint: string, chain: ChainId = "solana"): WatchToken | undefined {
  const onBook = bookTokens(chain).find((token) => sameMint(token.mint, mint));
  if (onBook) return onBook;
  if (chain !== "solana") return undefined;
  return WATCH_BY_MINT.get(mint);
}
