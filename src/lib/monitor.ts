import { PublicKey } from "@solana/web3.js";
import type { AppState } from "@/lib/types";
import { learningReport } from "@/lib/trading/learn";

export interface WatchBalances {
  address: string;
  sol: number;
  usdc: number;
  solPriceUsd: number | null;
  equityUsd: number;
}

export interface MonitorView {
  address: string;
  hasBook: boolean;
  sol: number | null;
  usdc: number | null;
  solPriceUsd: number | null;
  walletEquityUsd: number | null;
  paperEquityUsd: number | null;
  dayPnlUsd: number | null;
  cashUsd: number | null;
  winCount: number;
  lossCount: number;
  hitRate: number | null;
  running: boolean;
  ticks: number;
  lastNote: string | null;
  lastTickAt: string | null;
  positions: AppState["positions"];
  trades: AppState["trades"];
  equityCurve: number[];
  learningSummary: string | null;
}

export function parseWalletAddress(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length < 32 || trimmed.length > 44) return null;
  try {
    return new PublicKey(trimmed).toBase58();
  } catch {
    return null;
  }
}

export function watchHref(address: string, pathname = "/"): string {
  const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return `${path}?watch=${encodeURIComponent(address)}`;
}

export function buildMonitor(address: string, book: AppState | null, balances: WatchBalances | null): MonitorView {
  const wins = book?.portfolio.winCount ?? 0;
  const losses = book?.portfolio.lossCount ?? 0;
  const samples = wins + losses;
  return {
    address,
    hasBook: Boolean(book),
    sol: balances?.sol ?? null,
    usdc: balances?.usdc ?? null,
    solPriceUsd: balances?.solPriceUsd ?? null,
    walletEquityUsd: balances?.equityUsd ?? null,
    paperEquityUsd: book?.portfolio.equityUsd ?? null,
    dayPnlUsd: book?.portfolio.dayPnlUsd ?? null,
    cashUsd: book?.portfolio.cashUsd ?? null,
    winCount: wins,
    lossCount: losses,
    hitRate: samples ? (wins / samples) * 100 : null,
    running: Boolean(book?.bot.running),
    ticks: book?.bot.ticks ?? 0,
    lastNote: book?.bot.lastNote ?? null,
    lastTickAt: book?.bot.lastTickAt ?? null,
    positions: book?.positions ?? [],
    trades: book?.trades ?? [],
    equityCurve: book?.equityCurve.map((point) => point.equity) ?? [],
    learningSummary: book ? learningReport(book.memory).summary : null,
  };
}
