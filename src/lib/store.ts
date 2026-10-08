import type { ChainId } from "@/lib/chain";
import { DEFAULT_VENUES, normalizeVenues } from "@/lib/market/venues";
import type { AppState, BotConfig } from "@/lib/types";
import { resumeLiveSession } from "@/lib/solana/live-session";
import { emptyMemory, ensureMemory } from "@/lib/trading/learn";
import { normalizeMultipliers } from "@/lib/trading/leverage";
import {
  DEFAULT_ARM_FUNDS_USD,
  DEFAULT_BUY_SIZE_USD,
  DEFAULT_CRONOS_QUOTE,
  DEFAULT_SOL_TRADE_MODE,
  normalizeArmFundsUsd,
  normalizeBuySizeUsd,
  normalizeCronosQuote,
  normalizeMarginOnFourHour,
  resolveSolTradeMode,
} from "@/lib/deskSettings";
import { MIN_TRADE_USD, POLICY } from "@/lib/trading/risk";

export const DEFAULT_CONFIG: BotConfig = {
  startingEquity: 0,
  maxPositions: 4,
  maxRiskPerTradePct: 1.1,
  dailyLossLimitPct: 6,
  minLiquidityUsd: 120_000,
  minVolume24hUsd: 80_000,
  minAgeHours: 8,
  allowShorts: false,
  allowMemes: true,
  scanSeconds: 5,
  ...POLICY,
  venues: [...DEFAULT_VENUES],
  walletSwaps: false,
  liveTradesRev: 1,
  multipliers: [5, 10],
  solTradeMode: DEFAULT_SOL_TRADE_MODE,
  marginOnFourHour: false,
  executionMode: "paper",
  slippageBps: 80,
  maxLiveNotionalUsd: 250,
  armFundsUsd: DEFAULT_ARM_FUNDS_USD,
  buySizeUsd: DEFAULT_BUY_SIZE_USD,
  cronosQuote: DEFAULT_CRONOS_QUOTE,
  minSolForFees: 0.02,
  killSwitch: false,
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
    allowShorts: false,
    allowMemes: asBool(src.allowMemes, DEFAULT_CONFIG.allowMemes),
    scanSeconds: clampNum(src.scanSeconds, DEFAULT_CONFIG.scanSeconds, 4, 60, true),
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
    stopLossPct: clampNum(src.stopLossPct, POLICY.stopLossPct, 0.4, 15),
    targetProfitPct: clampNum(src.targetProfitPct, POLICY.targetProfitPct, 0.5, 30),
    timeCapMin: clampNum(src.timeCapMin, POLICY.timeCapMin, 30, 360, true),
    memeTimeCapMin: clampNum(src.memeTimeCapMin, POLICY.memeTimeCapMin, 10, 180, true),
    staleMin: clampNum(src.staleMin, POLICY.staleMin, 10, 240, true),
    memeStaleMin: clampNum(src.memeStaleMin, POLICY.memeStaleMin, 8, 120, true),
    scratchEnabled: asBool(src.scratchEnabled, POLICY.scratchEnabled),
    venues: normalizeVenues(input?.venues),
    multipliers: normalizeMultipliers(input && "multipliers" in input ? input.multipliers : src.multipliers),
    solTradeMode: resolveSolTradeMode(input, normalizeMultipliers(input && "multipliers" in input ? input.multipliers : src.multipliers)),
    marginOnFourHour: normalizeMarginOnFourHour(src.marginOnFourHour),
    slippageBps: clampNum(src.slippageBps, DEFAULT_CONFIG.slippageBps, 1, 2_000, true),
    maxLiveNotionalUsd: clampNum(src.maxLiveNotionalUsd, DEFAULT_CONFIG.maxLiveNotionalUsd, 5, 10_000),
    armFundsUsd: normalizeArmFundsUsd(src.armFundsUsd),
    buySizeUsd: normalizeBuySizeUsd(src.buySizeUsd, normalizeArmFundsUsd(src.armFundsUsd)),
    cronosQuote: normalizeCronosQuote(src.cronosQuote),
    minSolForFees: clampNum(src.minSolForFees, DEFAULT_CONFIG.minSolForFees, 0.004, 0.2),
    killSwitch: asBool(src.killSwitch, false),
    strategyRev: clampNum(input?.strategyRev, 0, 0, 99, true),
    ...liveSwapChoice(input, src),
  };
}

/**
 * Replayed over 120 days of SOL/PUMP/ZEC/RAY minute bars with fees, the 15m flow
 * entries, the fade exit and 5x/10x each lost money. The 4-hour setups with a wide
 * stop, a 2:1 target and room to work came closest to flat, so Solana books start there.
 */
export const SOLANA_STRATEGY = {
  stopLossPct: 4,
  targetProfitPct: 8,
  staleMin: 240,
  timeCapMin: 360,
  memeStaleMin: 120,
  memeTimeCapMin: 180,
  scratchEnabled: false,
  multipliers: [] as number[],
  solTradeMode: DEFAULT_SOL_TRADE_MODE,
  marginOnFourHour: false,
  strategyRev: 1,
} satisfies Partial<BotConfig>;

export function solanaDefaults(): BotConfig {
  return normalizeConfig({ ...DEFAULT_CONFIG, ...SOLANA_STRATEGY });
}

/** One-time move of a saved Solana book onto the tested strategy. Later edits stick. */
export function withSolanaStrategy(config: BotConfig): BotConfig {
  if ((config.strategyRev ?? 0) >= SOLANA_STRATEGY.strategyRev) return config;
  return normalizeConfig({ ...config, ...SOLANA_STRATEGY });
}

/** Solana and Cronos share the 4-hour stop, target, and time defaults. Later edits stick. */
function chainConfig(chain: ChainId, config: Partial<BotConfig>): Partial<BotConfig> {
  const next = normalizeConfig(config);
  return chain === "solana" || chain === "cronos" ? withSolanaStrategy(next) : next;
}

/**
 * Older books were saved with swaps off because that used to be the default.
 * The rev is read from the saved object only, so the new default does not count as a choice.
 */
function liveSwapChoice(
  input: Partial<BotConfig> | null | undefined,
  merged: Partial<BotConfig>,
): { walletSwaps: boolean; liveTradesRev: number; executionMode: BotConfig["executionMode"] } {
  const savedRev = input?.liveTradesRev;
  const chosen = typeof savedRev === "number" && Number.isFinite(savedRev) && savedRev >= 1;
  const exec = input?.executionMode === "live" || input?.executionMode === "paper" ? input.executionMode : null;
  let swaps = chosen ? asBool(merged.walletSwaps, false) : false;
  if (exec === "live") swaps = true;
  if (exec === "paper") swaps = false;
  return { walletSwaps: swaps, liveTradesRev: 1, executionMode: swaps ? "live" : "paper" };
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

function lastWalletKey(chain: ChainId): string {
  return `t800-trader-last-wallet:${chain}`;
}

export function readLastWallet(chain: ChainId): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(lastWalletKey(chain));
  } catch {
    return null;
  }
}

export function writeLastWallet(chain: ChainId, address: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(lastWalletKey(chain), address);
  } catch {
    // The in-memory slot still holds the book.
  }
}

export function clearLastWallet(chain: ChainId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(lastWalletKey(chain));
  } catch {
    // The next connect writes a new address.
  }
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
  const found = readRaw(bookStorageKey(chain, wallet)) ?? (chain === "solana" ? readRaw(legacyStorageKey(wallet)) : null);
  if (!found) return found;
  return { ...found, config: withSolanaStrategy(found.config) };
}

function blankBook(chain: ChainId, startingEquity = 0): AppState {
  return emptyState(chainConfig(chain, { ...DEFAULT_CONFIG, startingEquity }));
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

function keepRunningBot(previous: AppState, next: AppState): AppState {
  if (!previous.bot.running) return next;
  return { ...next, bot: { ...previous.bot, lastError: next.bot.lastError } };
}

function dropStaleLiveLock(state: AppState): AppState {
  const blocked = (state.bot.blocked ?? []).filter((line) => !/re-confirm live/i.test(line));
  const lastError = state.bot.lastError && /re-confirm live/i.test(state.bot.lastError) ? null : state.bot.lastError;
  if (blocked.length === (state.bot.blocked ?? []).length && lastError === state.bot.lastError) return state;
  return { ...state, bot: { ...state.bot, blocked, lastError } };
}

export function seedFromLiveEquity(state: AppState, liveEquityUsd: number): AppState {
  if (!isIdleEmptyBook(state)) return state;
  const target = state.config.armFundsUsd;
  if (state.config.walletSwaps && liveEquityUsd < MIN_TRADE_USD) return state;
  if (target < MIN_TRADE_USD) return state;
  return keepRunningBot(state, emptyState({ ...state.config, startingEquity: target }));
}

/** Flat book only. A sub-$3 live read leaves an already funded book alone. */
export function freshBook(state: AppState, liveEquityUsd: number): AppState {
  if (state.positions.length > 0 || state.trades.length > 0) return state;
  const target = state.config.armFundsUsd;
  if (state.config.walletSwaps && liveEquityUsd < MIN_TRADE_USD) return state;
  if (target < MIN_TRADE_USD) return state;
  return keepRunningBot(state, emptyState({ ...state.config, startingEquity: target }));
}

export async function adoptLiveEquity(liveEquityUsd: number, chain: ChainId = "solana"): Promise<AppState> {
  const slot = slotFor(chain);
  if (!slot.wallet) throw new Error(walletError(chain));
  const current = slot.memory ?? readBrowserState(chain, slot.wallet) ?? blankBook(chain);
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
  } else {
    slot.wallet = address;
    const loaded = readBrowserState(chain, address);
    slot.memory = loaded
      ? seedFromLiveEquity(loaded, liveEquityUsd)
      : blankBook(chain, Math.max(0, liveEquityUsd));
    writeBrowserState(chain, address, slot.memory);
  }
  writeLastWallet(chain, address);
  if (slot.memory.bot.running && slot.memory.config.walletSwaps) resumeLiveSession();
  if (slot.memory.bot.running) {
    const cleaned = dropStaleLiveLock(slot.memory);
    if (cleaned !== slot.memory) {
      slot.memory = cleaned;
      writeBrowserState(chain, address, slot.memory);
    }
  }
  return slot.memory;
}

/** Open the last saved book so a refresh can keep ticking before the wallet returns. */
export async function resumeSavedBook(chain: ChainId = "solana"): Promise<AppState | null> {
  const last = readLastWallet(chain);
  if (!last) return null;
  const saved = peekBook(last, chain);
  if (!saved) return null;
  return attachWallet(last, Math.max(0, saved.portfolio.equityUsd), chain);
}

export function detachWallet(chain: ChainId = "solana"): void {
  const slot = slotFor(chain);
  slot.wallet = null;
  slot.memory = null;
  clearLastWallet(chain);
}

export async function loadState(chain: ChainId = "solana"): Promise<AppState> {
  const slot = slotFor(chain);
  if (!slot.wallet) throw new Error(walletError(chain));
  if (slot.memory) return slot.memory;
  slot.memory = readBrowserState(chain, slot.wallet) ?? blankBook(chain);
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
