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

export const WATCHLIST: WatchToken[] = [
  { symbol: "SOL", name: "Solana", mint: SOL_MINT, sector: "L1" },
  { symbol: "JUP", name: "Jupiter", mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", sector: "DEX" },
  { symbol: "JTO", name: "Jito", mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", sector: "LST" },
  { symbol: "RAY", name: "Raydium", mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", sector: "DEX" },
  { symbol: "ORCA", name: "Orca", mint: "orcaEKTdK7LKz57vaA7iQxNhMvpvA2aP8VDgQ1sVR8", sector: "DEX" },
  { symbol: "PYTH", name: "Pyth", mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", sector: "Oracle" },
  { symbol: "DRIFT", name: "Drift", mint: "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7", sector: "Perps" },
  { symbol: "MNDE", name: "Marinade", mint: "MNDEFzGvMt87ueuHvVU9VcTQSQB6XND51pVSJD1YJXB", sector: "LST" },
  { symbol: "HNT", name: "Helium", mint: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrE3XEbKcP", sector: "DePIN" },
  { symbol: "RENDER", name: "Render", mint: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof", sector: "DePIN" },
  { symbol: "W", name: "Wormhole", mint: "85VBFQZC9TZkfaptBWtv8W11s6tJy3Dg6ZEr3GUeA6S", sector: "Infra" },
  { symbol: "TNSR", name: "Tensor", mint: "TNSRxcUxoT9xBG3de7PiWmgQhEQ1e6bwS4P8Cdgx31A", sector: "Infra" },
  { symbol: "BONK", name: "Bonk", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", sector: "Meme" },
  { symbol: "WIF", name: "dogwifhat", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", sector: "Meme" },
  { symbol: "JLP", name: "Jupiter Perps LP", mint: "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4", sector: "Perps" },
];

const WATCH_BY_MINT = new Map(WATCHLIST.map((t) => [t.mint, t]));
const WATCH_BY_SYMBOL = new Map(WATCHLIST.map((t) => [t.symbol.toUpperCase(), t]));

const STABLE_SYMS = new Set(["USDC", "USDT", "USD1", "PYUSD", "USDS", "DAI", "FDUSD", "CASH"]);
const QUOTE_SYMS = new Set(["SOL", "WSOL", "USDC", "USDT"]);

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
  if (/(pay|usdc|cash|stripe)/.test(blob)) return "Payments";
  return "Unknown";
}

export function watchMeta(mint: string): WatchToken | undefined {
  return WATCH_BY_MINT.get(mint);
}
