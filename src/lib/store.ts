import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
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

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_PATH = path.join(DATA_DIR, "state.json");

let memory: AppState | null = null;
let writeQueue: Promise<void> = Promise.resolve();

export async function loadState(): Promise<AppState> {
  if (memory) return memory;
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    memory = JSON.parse(raw) as AppState;
    return memory;
  } catch {
    memory = emptyState();
    return memory;
  }
}

export async function saveState(next: AppState): Promise<AppState> {
  memory = next;
  writeQueue = writeQueue.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(STATE_PATH, JSON.stringify(next, null, 2), "utf8");
  });
  await writeQueue;
  return next;
}

export async function mutateState(fn: (state: AppState) => AppState | Promise<AppState>): Promise<AppState> {
  const current = await loadState();
  const next = await fn(structuredClone(current));
  return saveState(next);
}
