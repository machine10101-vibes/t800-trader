import type { AppState, BotConfig } from "@/lib/types";

export const DEFAULT_CONFIG: BotConfig = {
  startingEquity: 10_000,
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

const STORAGE_KEY = "t800-trader-state";

export function emptyState(config: BotConfig = DEFAULT_CONFIG): AppState {
  return {
    config,
    bot: { running: false, lastTickAt: null, lastError: null, ticks: 0, startedAt: null },
    portfolio: {
      cashUsd: config.startingEquity,
      equityUsd: config.startingEquity,
      peakEquity: config.startingEquity,
      dayStartEquity: config.startingEquity,
      dayPnlUsd: 0,
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 0,
      winCount: 0,
      lossCount: 0,
      tradeCount: 0,
    },
    positions: [],
    trades: [],
    equityCurve: [{ t: new Date().toISOString(), equity: config.startingEquity }],
    lastSignals: [],
  };
}

let memory: AppState | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function readBrowserState(): AppState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed?.config || !parsed?.portfolio) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeBrowserState(next: AppState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota or private-mode — keep the in-memory book.
  }
}

export async function loadState(): Promise<AppState> {
  if (memory) return memory;
  memory = readBrowserState() ?? emptyState();
  return memory;
}

export async function saveState(next: AppState): Promise<AppState> {
  memory = next;
  writeBrowserState(next);
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
