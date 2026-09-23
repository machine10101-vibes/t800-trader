import type { AppState, BotConfig } from "@/lib/types";

export const DEFAULT_CONFIG: BotConfig = {
  startingEquity: 0,
  maxPositions: 4,
  maxRiskPerTradePct: 1.1,
  dailyLossLimitPct: 6,
  minLiquidityUsd: 120_000,
  minVolume24hUsd: 80_000,
  minAgeHours: 8,
  allowShorts: true,
  allowMemes: true,
  scanSeconds: 8,
};

let activeWallet: string | null = null;
let memory: AppState | null = null;
let writeQueue: Promise<void> = Promise.resolve();

export function getActiveWallet(): string | null {
  return activeWallet;
}

function storageKey(wallet: string): string {
  return `t800-trader-state:${wallet}`;
}

export function emptyState(config: BotConfig = DEFAULT_CONFIG): AppState {
  const equity = Math.max(0, config.startingEquity);
  return {
    config: { ...config, startingEquity: equity },
    bot: { running: false, lastTickAt: null, lastError: null, ticks: 0, startedAt: null },
    portfolio: {
      cashUsd: equity,
      equityUsd: equity,
      peakEquity: equity,
      dayStartEquity: equity,
      dayPnlUsd: 0,
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 0,
      winCount: 0,
      lossCount: 0,
      tradeCount: 0,
    },
    positions: [],
    trades: [],
    equityCurve: equity > 0 ? [{ t: new Date().toISOString(), equity }] : [],
    lastSignals: [],
  };
}

function readBrowserState(wallet: string): AppState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(wallet));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed?.config || !parsed?.portfolio) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeBrowserState(wallet: string, next: AppState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(wallet), JSON.stringify(next));
  } catch {
    // Quota or private-mode — keep the in-memory book.
  }
}

export async function attachWallet(address: string, liveEquityUsd: number): Promise<AppState> {
  if (activeWallet === address && memory) return memory;
  activeWallet = address;
  const loaded = readBrowserState(address);
  if (loaded) {
    memory = loaded;
    return memory;
  }
  memory = emptyState({ ...DEFAULT_CONFIG, startingEquity: Math.max(0, liveEquityUsd) });
  writeBrowserState(address, memory);
  return memory;
}

export function detachWallet(): void {
  activeWallet = null;
  memory = null;
}

export async function loadState(): Promise<AppState> {
  if (!activeWallet) {
    throw new Error("Connect a Solana wallet to load a live book.");
  }
  if (memory) return memory;
  memory = readBrowserState(activeWallet) ?? emptyState();
  return memory;
}

export async function saveState(next: AppState): Promise<AppState> {
  if (!activeWallet) throw new Error("Connect a Solana wallet to persist the book.");
  memory = next;
  writeBrowserState(activeWallet, next);
  return next;
}

export async function mutateState(fn: (state: AppState) => AppState | Promise<AppState>): Promise<AppState> {
  const run = writeQueue.then(async () => {
    const current = await loadState();
    const next = await fn(structuredClone(current));
    return saveState(next);
  });
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
