import { sameMint, type ChainId } from "@/lib/chain";
import type { Sector } from "@/lib/types";

export interface WatchToken {
  symbol: string;
  name: string;
  mint: string;
  sector: Sector;
}

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export const JITO_SOL_MINT = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
export const JLP_MINT = "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4";
export const ZBCN_MINT = "ZBCNpuD7YMXzTHB2fhGkGi78MNsHGLRXUhRewNRm9RU";

/** Wrapped CRO on Cronos. The desk trades this as CRO. */
export const WCRO_MINT = "0x5c7f8a570d578ed84e63fdfa7b1ee72deae1ae23";
/** USDC on the VVS WCRO pool. */
export const CRONOS_USDC = "0xc21223249ca28397b4b6541dffaecc539bff0c59";
/** Deep VVS WCRO/USDC pool. GeckoTerminal network id is `cro`. */
export const CRO_POOL = "0xe61db569e231b3f5530168aa2c9d50246525b6d6";

/** The only names the Solana desk monitors and trades. */
export const ACTIVE_BOOK = [SOL_MINT, ZBCN_MINT] as const;

const CRONOS_BOOK: WatchToken[] = [{ symbol: "CRO", name: "Cronos", mint: WCRO_MINT, sector: "L1" }];

export function geckoNetwork(chain: ChainId = "solana"): string {
  return chain === "cronos" ? "cro" : "solana";
}

/** Liquid SOL/USDC pools GeckoTerminal indexes — used when a finalist has no 5m tape. */
export const SOL_USDC_POOLS = [
  "8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj",
  "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
];

/** One deep pool per name the desk trades, so a tick does not list every pool on the mint. */
export const BOOK_POOLS: { mint: string; pool: string }[] = [
  { mint: SOL_MINT, pool: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2" },
  { mint: ZBCN_MINT, pool: "FaoZEZFsRS2jJAzg5PXwNjDdA1hDAjDGAkDf4xRfY79w" },
];

export const WATCHLIST: WatchToken[] = [
  { symbol: "SOL", name: "Solana", mint: SOL_MINT, sector: "L1" },
  { symbol: "JUP", name: "Jupiter", mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", sector: "DEX" },
  { symbol: "JTO", name: "Jito", mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", sector: "LST" },
  { symbol: "JITOSOL", name: "Jito Staked SOL", mint: JITO_SOL_MINT, sector: "LST" },
  { symbol: "RAY", name: "Raydium", mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", sector: "DEX" },
  { symbol: "ORCA", name: "Orca", mint: "orcaEKTdK7LKz57vaA7iQxNhMvpvA2aP8VDgQ1sVR8", sector: "DEX" },
  { symbol: "PYTH", name: "Pyth", mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", sector: "Oracle" },
  { symbol: "DRIFT", name: "Drift", mint: "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7", sector: "Perps" },
  { symbol: "JLP", name: "Jupiter Perps LP", mint: JLP_MINT, sector: "Perps" },
  { symbol: "MNDE", name: "Marinade", mint: "MNDEFzGvMt87ueuHvVU9VcTQSQB6XND51pVSJD1YJXB", sector: "LST" },
  { symbol: "HNT", name: "Helium", mint: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrE3XEbKcP", sector: "DePIN" },
  { symbol: "RENDER", name: "Render", mint: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof", sector: "DePIN" },
  { symbol: "ZBCN", name: "Zebec Network", mint: ZBCN_MINT, sector: "Payments" },
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

export function bookTokens(chain: ChainId = "solana"): WatchToken[] {
  if (chain === "cronos") return CRONOS_BOOK;
  return ACTIVE_BOOK.map((mint) => WATCH_BY_MINT.get(mint)).filter((token): token is WatchToken => Boolean(token));
}

export function bookPools(chain: ChainId = "solana"): { mint: string; pool: string }[] {
  if (chain === "cronos") return [{ mint: WCRO_MINT, pool: CRO_POOL }];
  return BOOK_POOLS;
}

export function bookMints(chain: ChainId = "solana"): string[] {
  return bookTokens(chain).map((token) => token.mint);
}

export function headlineFor(chain: ChainId = "solana"): { symbol: string; label: string }[] {
  if (chain === "cronos") return [{ symbol: "CRO", label: "CRO" }];
  return [
    { symbol: "SOL", label: "SOL" },
    { symbol: "ZBCN", label: "Zebec" },
  ];
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
