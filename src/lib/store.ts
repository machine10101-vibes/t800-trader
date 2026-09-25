import type { ChainId } from "@/lib/chain";
import { DEFAULT_VENUES, normalizeVenues } from "@/lib/market/venues";
import type { AppState, BotConfig } from "@/lib/types";
import { emptyMemory, ensureMemory } from "@/lib/trading/learn";
import { normalizeMultipliers } from "@/lib/trading/leverage";
import { MIN_TRADE_USD, POLICY } from "@/lib/trading/risk";

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
  ...POLICY,
  venues: [...DEFAULT_VENUES],
  walletSwaps: true,
  liveTradesRev: 1,
  multipliers: [5, 10],
};

function clampNum(value: unknown, fallback: number, min: number, max: number, round = false): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(max, Math.max(min, n));
  return round ? Math.round(clamped) : clamped;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Merge an older or partial book config onto the current policy defaults. */
export function normalizeConfig(input?: Partial<BotConfig> | null): BotConfig {
  const src: Partial<BotConfig> = { ...DEFAULT_CONFIG, ...(input ?? {}) };
  return {
    startingEquity: clampNum(src.startingEquity, 0, 0, 1_000_000_000),
    maxPositions: clampNum(src.maxPositions, DEFAULT_CONFIG.maxPositions, 1, 8, true),
    maxRiskPerTradePct: clampNum(src.maxRiskPerTradePct, DEFAULT_CONFIG.maxRiskPerTradePct, 0.3, 2.5),
    dailyLossLimitPct: clampNum(src.dailyLossLimitPct, DEFAULT_CONFIG.dailyLossLimitPct, 2, 15),
    minLiquidityUsd: clampNum(src.minLiquidityUsd, DEFAULT_CONFIG.minLiquidityUsd, 20_000, 2_000_000),
    minVolume24hUsd: clampNum(src.minVolume24hUsd, DEFAULT_CONFIG.minVolume24hUsd, 10_000, 2_000_000),
    minAgeHours: clampNum(src.minAgeHours, DEFAULT_CONFIG.minAgeHours, 0, 168, true),
    allowShorts: asBool(src.allowShorts, DEFAULT_CONFIG.allowShorts),
    allowMemes: asBool(src.allowMemes, DEFAULT_CONFIG.allowMemes),
    scanSeconds: clampNum(src.scanSeconds, DEFAULT_CONFIG.scanSeconds, 6, 60, true),
    oneTicketPerTick: asBool(src.oneTicketPerTick, POLICY.oneTicketPerTick),
    microOneTicket: asBool(src.microOneTicket, POLICY.microOneTicket),
    maxPerSector: clampNum(src.maxPerSector, POLICY.maxPerSector, 1, 4, true),
    lossStreakPause: clampNum(src.lossStreakPause, POLICY.lossStreakPause, 0, 8, true),
    cooldownMinutes: clampNum(src.cooldownMinutes, POLICY.cooldownMinutes, 0, 180, true),
    minConfidence: clampNum(src.minConfidence, POLICY.minConfidence, 50, 85, true),
    autoCash: asBool(src.autoCash, POLICY.autoCash),
    cashPct: clampNum(src.cashPct, POLICY.cashPct, 20, 95, true),
    dayBudgetPct: clampNum(src.dayBudgetPct, POLICY.dayBudgetPct, 50, 100, true),
    defensiveBreakoutScore: clampNum(src.defensiveBreakoutScore, POLICY.defensiveBreakoutScore, 50, 90, true),
    beR: clampNum(src.beR, POLICY.beR, 0.3, 2),
    scaleAtR: clampNum(src.scaleAtR, POLICY.scaleAtR, 0.5, 3),
    scaleFractionPct: clampNum(src.scaleFractionPct, POLICY.scaleFractionPct, 25, 75, true),
    lockAtR: clampNum(src.lockAtR, POLICY.lockAtR, 1, 4),
    lockProfitR: clampNum(src.lockProfitR, POLICY.lockProfitR, 0.05, 1.5),
    timeCapMin: clampNum(src.timeCapMin, POLICY.timeCapMin, 30, 360, true),
    memeTimeCapMin: clampNum(src.memeTimeCapMin, POLICY.memeTimeCapMin, 10, 180, true),
    staleMin: clampNum(src.staleMin, POLICY.staleMin, 10, 240, true),
    memeStaleMin: clampNum(src.memeStaleMin, POLICY.memeStaleMin, 8, 120, true),
    scratchEnabled: asBool(src.scratchEnabled, POLICY.scratchEnabled),
    venues: normalizeVenues(input?.venues),
    multipliers: normalizeMultipliers(input && "multipliers" in input ? input.multipliers : src.multipliers),
    ...liveSwapChoice(input, src),
  };
}

/**
 * Older books were saved with swaps off because that used to be the default.
 * The rev is read from the saved object only, so the new default does not count as a choice.
 */
function liveSwapChoice(
  input: Partial<BotConfig> | null | undefined,
  merged: Partial<BotConfig>,
): { walletSwaps: boolean; liveTradesRev: number } {
  const savedRev = input?.liveTradesRev;
  const chosen = typeof savedRev === "number" && Number.isFinite(savedRev) && savedRev >= 1;
  if (chosen) return { walletSwaps: asBool(merged.walletSwaps, true), liveTradesRev: 1 };
  return { walletSwaps: true, liveTradesRev: 1 };
}

function hydrate(state: AppState): AppState {
  return { ...state, config: normalizeConfig(state.config), memory: ensureMemory(state.memory) };
}

interface BookSlot {
  wallet: string | null;
  memory: AppState | null;
  writeQueue: Promise<void>;
}

function blankSlot(): BookSlot {
  return { wallet: null, memory: null, writeQueue: Promise.resolve() };
}

const slots: Record<ChainId, BookSlot> = {
  solana: blankSlot(),
  cronos: blankSlot(),
};

function slotFor(chain: ChainId = "solana"): BookSlot {
  return slots[chain];
}

function walletError(chain: ChainId): string {
  return chain === "cronos"
    ? "Connect a Cronos wallet to load a live book."
    : "Connect a Solana wallet to load a live book.";
}

export function getActiveWallet(chain: ChainId = "solana"): string | null {
  return slotFor(chain).wallet;
}

export function bookStorageKey(chain: ChainId, wallet: string): string {
  return `t800-trader-state:${chain}:${wallet}`;
}

function legacyStorageKey(wallet: string): string {
  return `t800-trader-state:${wallet}`;
}

export function emptyState(config: Partial<BotConfig> = DEFAULT_CONFIG): AppState {
  const resolved = normalizeConfig(config);
  const equity = Math.max(0, resolved.startingEquity);
  return {
    config: { ...resolved, startingEquity: equity },
    bot: {
      running: false,
      lastTickAt: null,
      lastError: null,
      ticks: 0,
      startedAt: null,
      lastNote: null,
      lastOpened: 0,
      lastClosed: 0,
      blocked: [],
    },
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
      sessionDay: new Date().toISOString().slice(0, 10),
    },
    positions: [],
    trades: [],
    equityCurve: equity > 0 ? [{ t: new Date().toISOString(), equity }] : [],
    lastSignals: [],
    memory: emptyMemory(),
  };
}

export function peekBook(address: string, chain: ChainId = "solana"): AppState | null {
  return readBrowserState(chain, address);
}

export function listLocalBooks(chain: ChainId = "solana"): string[] {
  if (typeof window === "undefined") return [];
  const prefix = `t800-trader-state:${chain}:`;
  const legacy = "t800-trader-state:";
  const out: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key) continue;
    if (key.startsWith(prefix)) {
      out.push(key.slice(prefix.length));
      continue;
    }
    if (chain !== "solana" || !key.startsWith(legacy)) continue;
    const addr = key.slice(legacy.length);
    if (!addr || addr.includes(":") || out.includes(addr)) continue;
    out.push(addr);
  }
  return out;
}

function readRaw(key: string): AppState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed?.config || !parsed?.portfolio) return null;
    return hydrate(parsed);
  } catch {
    return null;
  }
}

function readBrowserState(chain: ChainId, wallet: string): AppState | null {
  const current = readRaw(bookStorageKey(chain, wallet));
  if (current) return current;
  if (chain === "solana") return readRaw(legacyStorageKey(wallet));
  return null;
}

function writeBrowserState(chain: ChainId, wallet: string, next: AppState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(bookStorageKey(chain, wallet), JSON.stringify(next));
  } catch {
    // Quota or private-mode — keep the in-memory book.
  }
}

export function isIdleEmptyBook(state: AppState): boolean {
  return (
    state.positions.length === 0 &&
    state.trades.length === 0 &&
    state.portfolio.cashUsd < MIN_TRADE_USD &&
    state.portfolio.equityUsd < MIN_TRADE_USD
  );
}

export function seedFromLiveEquity(state: AppState, liveEquityUsd: number): AppState {
  if (!isIdleEmptyBook(state)) return state;
  if (liveEquityUsd < MIN_TRADE_USD) return state;
  return emptyState({ ...state.config, startingEquity: liveEquityUsd });
}

/** Flat book only. A sub-$3 live read leaves an already funded book alone. */
export function freshBook(state: AppState, liveEquityUsd: number): AppState {
  if (state.positions.length > 0 || state.trades.length > 0) return state;
  if (liveEquityUsd < MIN_TRADE_USD) return state;
  return emptyState({ ...state.config, startingEquity: liveEquityUsd });
}

export async function adoptLiveEquity(liveEquityUsd: number, chain: ChainId = "solana"): Promise<AppState> {
  const slot = slotFor(chain);
  if (!slot.wallet) throw new Error(walletError(chain));
  const current = slot.memory ?? readBrowserState(chain, slot.wallet) ?? emptyState();
  const next = freshBook(current, liveEquityUsd);
  slot.memory = next;
  writeBrowserState(chain, slot.wallet, next);
  return next;
}

export async function attachWallet(address: string, liveEquityUsd: number, chain: ChainId = "solana"): Promise<AppState> {
  const slot = slotFor(chain);
  if (slot.wallet === address && slot.memory) {
    const next = seedFromLiveEquity(slot.memory, liveEquityUsd);
    if (next !== slot.memory) {
      slot.memory = next;
      writeBrowserState(chain, address, slot.memory);
    }
    return slot.memory;
  }
  slot.wallet = address;
  const loaded = readBrowserState(chain, address);
  if (loaded) {
    slot.memory = seedFromLiveEquity(loaded, liveEquityUsd);
    writeBrowserState(chain, address, slot.memory);
    return slot.memory;
  }
  slot.memory = emptyState({ ...DEFAULT_CONFIG, startingEquity: Math.max(0, liveEquityUsd) });
  writeBrowserState(chain, address, slot.memory);
  return slot.memory;
}

export function detachWallet(chain: ChainId = "solana"): void {
  const slot = slotFor(chain);
  slot.wallet = null;
  slot.memory = null;
}

export async function loadState(chain: ChainId = "solana"): Promise<AppState> {
  const slot = slotFor(chain);
  if (!slot.wallet) throw new Error(walletError(chain));
  if (slot.memory) return slot.memory;
  slot.memory = readBrowserState(chain, slot.wallet) ?? emptyState();
  return slot.memory;
}

export async function saveState(next: AppState, chain: ChainId = "solana"): Promise<AppState> {
  const slot = slotFor(chain);
  if (!slot.wallet) throw new Error(walletError(chain).replace("load a live book", "persist the book"));
  slot.memory = next;
  writeBrowserState(chain, slot.wallet, next);
  return next;
}

export async function mutateState(
  fn: (state: AppState) => AppState | Promise<AppState>,
  chain: ChainId = "solana",
): Promise<AppState> {
  const slot = slotFor(chain);
  const run = slot.writeQueue.then(async () => {
    const current = await loadState(chain);
    const next = await fn(structuredClone(current));
    return saveState(next, chain);
  });
  slot.writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
