import { sameMint } from "@/lib/chain";
import { SOL_MINT } from "@/lib/market/universe";
import type { BotConfig, MarketRegime, Portfolio, Position, Signal, Trade } from "@/lib/types";
import { feeHurdlePct, targetAboveFees } from "./fees";
import { JUPITER_MIN_COLLATERAL_USD, PERP_MIN_COLLATERAL_USD, PERP_RENT_SOL } from "./leverage";

/** Smallest marked trading balance the desk will arm and open against. */
export const MIN_TRADE_USD = 3;
/** Smallest ticket the execution loop will send. */
export const MIN_TICKET_USD = 1;
/** Books below this use micro sizing so a small wallet can actually fill. */
export const MICRO_BOOK_USD = 50;

/** Defaults for every policy knob. Missing keys on an older book resolve to these. */
export const POLICY = {
  oneTicketPerTick: true,
  microOneTicket: true,
  maxPerSector: 2,
  lossStreakPause: 3,
  cooldownMinutes: 20,
  minConfidence: 58,
  autoCash: true,
  cashPct: 35,
  dayBudgetPct: 90,
  defensiveBreakoutScore: 70,
  beR: 0.8,
  scaleAtR: 1,
  scaleFractionPct: 50,
  lockAtR: 1.5,
  lockProfitR: 0.45,
  stopLossPct: 2,
  targetProfitPct: 4,
  timeCapMin: 120,
  memeTimeCapMin: 40,
  staleMin: 45,
  memeStaleMin: 22,
  scratchEnabled: true,
} as const;

export function isMicroBook(equity: number): boolean {
  return equity > 0 && equity < MICRO_BOOK_USD;
}

export function cashConcentration(equity: number, config?: Pick<BotConfig, "autoCash" | "cashPct">): number {
  if (config && config.autoCash === false) return clampPct(config.cashPct, 20, 95) / 100;
  return isMicroBook(equity) ? 0.92 : 0.35;
}

function clampPct(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function policyNum(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function sizeCapPct(equity: number, stance: MarketRegime["stance"]): number {
  if (isMicroBook(equity)) {
    return stance === "defensive" ? 0.6 : stance === "mixed" ? 0.78 : 0.92;
  }
  return stance === "defensive" ? 0.08 : stance === "mixed" ? 0.14 : 0.2;
}

export function dayLossBreached(portfolio: Portfolio, config: BotConfig): boolean {
  const dd = ((portfolio.dayStartEquity - portfolio.equityUsd) / Math.max(portfolio.dayStartEquity, 1)) * 100;
  return dd >= config.dailyLossLimitPct;
}

export function maxDrawdownPct(peak: number, equity: number): number {
  if (peak <= 0) return 0;
  return Math.max(0, ((peak - equity) / peak) * 100);
}

export function dayLossUsedPct(portfolio: Portfolio, config: BotConfig): number {
  if (portfolio.dayStartEquity <= 0) return 0;
  const used = ((portfolio.dayStartEquity - portfolio.equityUsd) / portfolio.dayStartEquity) * 100;
  return Math.max(0, used / Math.max(config.dailyLossLimitPct, 0.1));
}

/** How long a losing streak pauses new tickets. Only a win resets the streak, so the pause has to expire on its own. */
export const LOSS_STREAK_PAUSE_MS = 60 * 60_000;

/** True while the last losing close of a streak is recent enough to hold new tickets. */
export function lossStreakPaused(trades: Trade[], cap: number, nowMs = Date.now()): boolean {
  if (!(cap > 0) || consecutiveLosses(trades) < cap) return false;
  const last = trades.find((t) => t.action === "close" && t.pnlUsd !== null);
  const at = last ? Date.parse(last.at) : NaN;
  return Number.isFinite(at) && nowMs - at < LOSS_STREAK_PAUSE_MS;
}

export function consecutiveLosses(trades: Trade[]): number {
  let n = 0;
  for (const t of trades) {
    if (t.action !== "close" || t.pnlUsd === null) continue;
    if (t.pnlUsd < 0) n += 1;
    else break;
  }
  return n;
}

export function sizePosition(args: {
  equity: number;
  price: number;
  stopPct: number;
  config: BotConfig;
  regime: MarketRegime;
  researchScore: number | null;
  confidence?: number;
  lossStreak?: number;
  dayUsed?: number;
}): { qty: number; notional: number } {
  const { equity, price, stopPct, config, regime } = args;
  if (price <= 0 || stopPct <= 0) return { qty: 0, notional: 0 };

  const capPct = sizeCapPct(equity, regime.stance);
  const target = Math.max(MIN_TICKET_USD, config.buySizeUsd || 0);
  const liveCap = config.maxLiveNotionalUsd > 0 ? config.maxLiveNotionalUsd : target;
  const notional = Math.min(target, liveCap, equity * capPct);
  if (notional < MIN_TICKET_USD) return { qty: 0, notional: 0 };
  const qty = notional / price;
  return { qty, notional };
}

export interface WalletBudget {
  usdc: number;
  sol: number;
  solPriceUsd: number;
}

/**
 * SOL left on the trading key for the network fee and a token account.
 * A 0.02 SOL arm (~$3–$4) must still have a spendable leg.
 */
export const SOL_FEE_RESERVE = 0.004;

/**
 * Dollars a SOL perp can actually post. USDC is used whole. SOL keeps the fee
 * reserve and the position-account rent, which a spot ticket does not need.
 */
export function solPerpPostableUsd(budget: WalletBudget): number {
  const px = budget.solPriceUsd > 0 ? budget.solPriceUsd : 0;
  const usdc = Math.max(0, budget.usdc);
  const solLeg = Math.max(0, budget.sol - SOL_FEE_RESERVE - PERP_RENT_SOL) * px;
  return Math.max(usdc, solLeg);
}

/**
 * Dollars that can open a SOL 5x or 10x. USDC counts in full.
 * SOL keeps the position-account rent when that still clears $5.
 * A fee-only balance that still clears $5 is used when the rent haircut
 * would otherwise turn a margin ticket into a spot buy.
 */
export function marginCashUsd(budget: WalletBudget): number {
  const px = budget.solPriceUsd > 0 ? budget.solPriceUsd : 0;
  const usdc = Math.max(0, budget.usdc);
  const afterRent = Math.max(0, budget.sol - SOL_FEE_RESERVE - PERP_RENT_SOL) * px;
  const afterFee = Math.max(0, budget.sol - SOL_FEE_RESERVE) * px;
  const solLeg =
    afterRent + 1e-9 >= JUPITER_MIN_COLLATERAL_USD
      ? afterRent
      : afterFee + 1e-9 >= PERP_MIN_COLLATERAL_USD
        ? afterFee
        : afterRent;
  return Math.max(usdc, solLeg);
}

/** One Jupiter swap spends either USDC or SOL, never a mix of the two. */
export function payableUsd(budget: WalletBudget): number {
  const px = budget.solPriceUsd > 0 ? budget.solPriceUsd : 0;
  const solLeg = Math.max(0, budget.sol - SOL_FEE_RESERVE) * px;
  return Math.max(Math.max(0, budget.usdc), solLeg);
}

export function walletMarkUsd(budget: WalletBudget): number {
  const px = budget.solPriceUsd > 0 ? budget.solPriceUsd : 0;
  return Math.max(0, budget.usdc) + Math.max(0, budget.sol) * px;
}

export function spendableUsd(budget: WalletBudget): number {
  return payableUsd(budget);
}

/**
 * Live mode spends the wallet, not the paper blotter.
 * Unsigned rows stay on screen but do not take a slot or a cash check.
 */
export function walletRiskBook(
  portfolio: Portfolio,
  positions: Position[],
  trades: Trade[],
  budget: WalletBudget | null | undefined,
  walletSwaps: boolean,
): { portfolio: Portfolio; positions: Position[]; trades: Trade[] } {
  if (!walletSwaps || !budget) return { portfolio, positions, trades };
  const livePositions = positions.filter((p) => Boolean(p.signature));
  const liveTrades = trades.filter((t) => Boolean(t.signature));
  const cashUsd = payableUsd(budget);
  const signedValue = livePositions.reduce((acc, p) => acc + positionEquity(p), 0);
  const equityUsd = walletMarkUsd(budget) + signedValue;
  const hasChainFill = liveTrades.length > 0;
  return {
    positions: livePositions,
    trades: liveTrades,
    portfolio: {
      ...portfolio,
      cashUsd,
      equityUsd,
      peakEquity: hasChainFill ? Math.max(portfolio.peakEquity, equityUsd) : equityUsd,
      dayStartEquity: hasChainFill ? portfolio.dayStartEquity : equityUsd,
      dayPnlUsd: hasChainFill ? equityUsd - portfolio.dayStartEquity : 0,
    },
  };
}

export function canOpen(args: {
  positions: Position[];
  signal: Signal;
  config: BotConfig;
  portfolio: Portfolio;
  trades?: Trade[];
  stance?: MarketRegime["stance"];
  /** Wallet swaps size from the spendable leg, which can sit under the marked $3 balance. */
  minCashUsd?: number;
  /** Shorts use the same setups in a falling tape on both chains. */
  defensiveShorts?: boolean;
}): string | null {
  const { positions, signal, config, portfolio, trades = [], stance } = args;
  if (config.killSwitch) return "Kill switch is on";
  if (signal.side === "short" && config.walletSwaps && !sameMint(signal.mint, SOL_MINT)) {
    return signal.mint.toLowerCase().startsWith("0x")
      ? "A live short is not sent on Cronos. WolfSwap and cro.trade only buy and sell. Practice can short this coin."
      : "A live short is SOL only, on Jupiter perps. Practice can short this coin.";
  }
  if (config.microOneTicket !== false && isMicroBook(portfolio.equityUsd) && positions.length >= 2) {
    return "Micro book rides two tickets";
  }
  if (positions.some((p) => p.mint === signal.mint)) return "Already in this mint";
  if (config.maxPositions > 0 && positions.length >= config.maxPositions) {
    return `Holding ${config.maxPositions} coins, the most allowed at once`;
  }
  if (dayLossBreached(portfolio, config)) return "Daily loss limit";
  if (!config.allowShorts && signal.side === "short") return "Shorts disabled";
  const minCash = args.minCashUsd ?? MIN_TRADE_USD;
  if (portfolio.cashUsd < minCash) return "Insufficient cash";
  if (stance === "defensive" && signal.side === "short" && !args.defensiveShorts) return "No shorts in a defensive tape";
  const breakoutScore = policyNum(config.defensiveBreakoutScore, POLICY.defensiveBreakoutScore);
  if (stance === "defensive" && signal.reason === "breakout" && (signal.researchScore ?? 0) < breakoutScore) {
    return `Breakouts need a ${breakoutScore}+ score when defensive`;
  }
  const sector = signal.sector ?? "Unknown";
  const sameSector = positions.filter((p) => (p.sector ?? "Unknown") === sector).length;
  const sectorCap = Math.max(1, policyNum(config.maxPerSector, POLICY.maxPerSector));
  if (sameSector >= sectorCap) return `Sector cap of ${sectorCap} reached for ${sector}`;
  if (sector === "Meme" && stance === "defensive") return "Memes are flattened in a defensive tape, so none are opened";
  if (sector === "Meme" && positions.filter((p) => p.sector === "Meme").length >= 1 && stance !== "risk-on") {
    return "Meme cluster capped off risk-on";
  }
  const lastStop = trades.find(
    (t) => t.mint === signal.mint && t.action === "close" && (t.reason === "stop" || t.reason === "time" || t.reason === "risk-off"),
  );
  const cooldownMin = Math.max(0, policyNum(config.cooldownMinutes, POLICY.cooldownMinutes));
  const cooldownMs = cooldownMin * 60_000;
  if (cooldownMs > 0 && lastStop && Date.now() - Date.parse(lastStop.at) < cooldownMs) {
    return "Cooldown after a stop/time-out on this mint";
  }
  const streakCap = policyNum(config.lossStreakPause, POLICY.lossStreakPause);
  if (lossStreakPaused(trades, streakCap)) return `Cooling for an hour after ${streakCap} straight losses`;
  const budget = policyNum(config.dayBudgetPct, POLICY.dayBudgetPct) / 100;
  if (dayLossUsedPct(portfolio, config) >= budget) return "Protect remaining day budget";
  const floor = policyNum(config.minConfidence, POLICY.minConfidence);
  const need = signal.sector === "Meme" || signal.sector === "Unknown" ? floor + 4 : floor;
  if (signal.confidence < need) return "Confidence below the quality floor";
  return null;
}

/** Cash value of a ticket. A perp contributes margin plus PnL, not the full exposure. */
export function positionEquity(position: Position): number {
  const lev = position.leverage ?? 1;
  if (lev > 1) {
    const margin = position.collateralUsd ?? (position.qty * position.entryPrice) / lev;
    return Math.max(0, margin + unrealizedPnl(position).usd);
  }
  if (position.side === "long") return Math.max(0, position.qty * position.markPrice);
  return Math.max(0, position.qty * (2 * position.entryPrice - position.markPrice));
}

export function markPosition(position: Position, price: number): Position {
  const highWater = position.side === "long" ? Math.max(position.highWater, price) : Math.min(position.highWater, price);
  const lowWater = position.side === "long" ? Math.min(position.lowWater, price) : Math.max(position.lowWater, price);
  return {
    ...position,
    markPrice: price,
    highWater,
    lowWater,
    lastUpdate: new Date().toISOString(),
    notional: position.qty * price,
  };
}

/** Dollars the ticket was worth at entry. Stop and target are a percent of this price. */
export function ticketEntryUsd(position: Pick<Position, "qty" | "entryPrice" | "notional">): number {
  const fromFill = position.qty * position.entryPrice;
  if (fromFill > 0) return fromFill;
  return position.notional > 0 ? position.notional : 0;
}

export function unrealizedPnl(position: Position): { usd: number; pct: number } {
  const dir = position.side === "long" ? 1 : -1;
  const pct = ((position.markPrice - position.entryPrice) / position.entryPrice) * 100 * dir;
  const basis = ticketEntryUsd(position);
  const usd = basis > 0 ? basis * (pct / 100) : 0;
  return { usd, pct };
}

/** 5x and 10x give the move back faster than a spot ticket, so they are managed on a shorter clock. */
function leverageHurry(leverage: number | undefined): number {
  const lev = leverage ?? 1;
  if (lev >= 10) return 0.45;
  if (lev >= 5) return 0.6;
  return 1;
}

/** Minutes since the fill. A missing timestamp is treated as already stale so a stuck ticket can exit. */
export function positionAgeMin(position: Pick<Position, "openedAt" | "lastUpdate">, nowMs = Date.now()): number {
  const opened = Date.parse(position.openedAt);
  if (Number.isFinite(opened)) return (nowMs - opened) / 60_000;
  const updated = Date.parse(position.lastUpdate);
  if (Number.isFinite(updated)) return (nowMs - updated) / 60_000;
  return Number.POSITIVE_INFINITY;
}

export function exitReason(
  position: Position,
  nowMs = Date.now(),
  timeCapMin?: number,
): "stop" | "target" | "trail" | "time" | "risk-off" | null {
  const { usd } = unrealizedPnl(position);
  const ageMin = positionAgeMin(position, nowMs);
  const fallback = (position.sector ?? "Unknown") === "Meme" ? POLICY.memeTimeCapMin : POLICY.timeCapMin;
  const timeCap = policyNum(timeCapMin, fallback);
  const trailFrac = (position.leverage ?? 1) >= 5 ? 0.35 : 0.55;
  if (position.side === "long") {
    if (position.markPrice <= position.stopPrice) return "stop";
    if (position.markPrice >= position.targetPrice) return "target";
    const locked = position.entryPrice + (position.targetPrice - position.entryPrice) * trailFrac;
    if (usd > 0 && position.highWater >= locked && position.markPrice < locked) return "trail";
  } else {
    if (position.markPrice >= position.stopPrice) return "stop";
    if (position.markPrice <= position.targetPrice) return "target";
    const locked = position.entryPrice - (position.entryPrice - position.targetPrice) * trailFrac;
    if (usd > 0 && position.highWater <= locked && position.markPrice > locked) return "trail";
  }
  if (ageMin > timeCap) return "time";
  return null;
}

export function rollSession(portfolio: Portfolio, now = new Date()): Portfolio {
  const day = now.toISOString().slice(0, 10);
  if (!portfolio.sessionDay) return { ...portfolio, sessionDay: day };
  if (portfolio.sessionDay === day) return portfolio;
  return {
    ...portfolio,
    sessionDay: day,
    dayStartEquity: portfolio.equityUsd,
    dayPnlUsd: 0,
  };
}

export function shouldScratch(position: Position, m5: number, m15: number): boolean {
  const r = rMultiple(position);
  const hurried = (position.leverage ?? 1) >= 5;
  const against = position.side === "short" ? 1 : -1;
  if (hurried && r < 0.35 && m5 * against >= 0.8) return true;
  if (r >= 0.25) return false;
  return m15 * against >= 1.2 && m5 * against >= 0.6;
}

export function shouldFlattenMeme(position: Position, stance: MarketRegime["stance"]): boolean {
  if (stance !== "defensive") return false;
  if ((position.sector ?? "Unknown") !== "Meme") return false;
  return unrealizedPnl(position).usd < 0;
}

export function rMultiple(position: Position): number {
  const risk = Math.abs(position.entryPrice - (position.initialStop || position.stopPrice));
  if (risk <= 0) return 0;
  const dir = position.side === "long" ? 1 : -1;
  return ((position.markPrice - position.entryPrice) * dir) / risk;
}

/** Percent the live mark has moved in the ticket's favor. Negative means the trade is losing. */
export function favorableMovePct(position: Pick<Position, "side" | "entryPrice" | "markPrice">): number {
  if (!(position.entryPrice > 0) || !(position.markPrice > 0)) return 0;
  const dir = position.side === "long" ? 1 : -1;
  return ((position.markPrice - position.entryPrice) / position.entryPrice) * 100 * dir;
}

function priceFromEntry(entry: number, side: Position["side"], pct: number, kind: "stop" | "target"): number {
  const frac = pct / 100;
  if (side === "long") return kind === "stop" ? entry * (1 - frac) : entry * (1 + frac);
  return kind === "stop" ? entry * (1 + frac) : entry * (1 - frac);
}

/**
 * Lock the settings stop and target onto a ticket once.
 * A later change to those percents does not move a bracket that is already preset.
 * A stop already trailed tighter than the original stays tighter on that first lock.
 */
export function alignBracket(position: Position, config?: Partial<BotConfig>): Position {
  const stopLossPct = policyNum(config?.stopLossPct, POLICY.stopLossPct);
  const targetProfitPct = policyNum(config?.targetProfitPct, POLICY.targetProfitPct);
  if (!(position.entryPrice > 0)) return position;
  const configuredStop = priceFromEntry(position.entryPrice, position.side, stopLossPct, "stop");
  const configuredTarget = priceFromEntry(position.entryPrice, position.side, targetProfitPct, "target");
  const trailed =
    position.side === "long"
      ? position.stopPrice > position.initialStop + 1e-9
      : position.stopPrice < position.initialStop - 1e-9;
  const stopPrice = trailed
    ? position.side === "long"
      ? Math.max(position.stopPrice, configuredStop)
      : Math.min(position.stopPrice, configuredStop)
    : configuredStop;
  return {
    ...position,
    stopPrice,
    initialStop: configuredStop,
    targetPrice: configuredTarget,
  };
}

/** First scan locks the settings bracket. After that the prices stay, except a target that cannot clear both fees. */
export function presetBracket(position: Position, config?: Partial<BotConfig>): Position {
  const hurdle = feeHurdlePct(position.mint, position.symbol, position.leverage ?? 1);
  if (position.bracketPreset) {
    if (!(hurdle > 0) || (position.targetProfitPct ?? 0) > hurdle) return position;
    return {
      ...position,
      targetProfitPct: hurdle,
      targetPrice: priceFromEntry(position.entryPrice, position.side, hurdle, "target"),
    };
  }
  const stopLossPct = policyNum(config?.stopLossPct, POLICY.stopLossPct);
  const targetProfitPct = targetAboveFees(
    position.mint,
    position.symbol,
    position.leverage ?? 1,
    policyNum(config?.targetProfitPct, POLICY.targetProfitPct),
  );
  return { ...alignBracket(position, { ...config, targetProfitPct }), bracketPreset: true, stopLossPct, targetProfitPct };
}

/** True when a sale at this mark would net more than the open fee and the close fee together. */
export function profitClearsFees(
  position: Pick<Position, "mint" | "symbol" | "leverage" | "side" | "entryPrice" | "markPrice">,
): boolean {
  const hurdle = feeHurdlePct(position.mint, position.symbol, position.leverage ?? 1);
  if (!(hurdle > 0)) return true;
  return favorableMovePct(position) > hurdle;
}

/** New tickets use the settings stop and target, not the signal's built-in percents. */
export function withUserBracket<T extends { stopPct: number; targetPct: number; mint?: string; symbol?: string }>(
  signal: T,
  config?: Partial<BotConfig>,
): T {
  const configured = policyNum(config?.targetProfitPct, POLICY.targetProfitPct);
  return {
    ...signal,
    stopPct: policyNum(config?.stopLossPct, POLICY.stopLossPct),
    targetPct: targetAboveFees(signal.mint ?? "", signal.symbol ?? "", 1, configured),
  };
}

export function managePosition(
  position: Position,
  nowMs = Date.now(),
  config?: Partial<BotConfig>,
): { nextStop?: number; exit?: "stop" | "target" | "trail" | "time" | "risk-off"; scale?: boolean; feeHold?: boolean } {
  const pnlPct = unrealizedPnl(position).pct;
  const clears = profitClearsFees(position);
  if (typeof position.targetProfitPct === "number" && pnlPct >= position.targetProfitPct - 1e-6) {
    if (pnlPct <= 0 || clears) return { exit: "target" };
    return { feeHold: true };
  }
  if (typeof position.stopLossPct === "number" && pnlPct <= -position.stopLossPct + 1e-6) return { exit: "stop" };
  const meme = (position.sector ?? "Unknown") === "Meme";
  const timeCap = meme
    ? policyNum(config?.memeTimeCapMin, POLICY.memeTimeCapMin)
    : policyNum(config?.timeCapMin, POLICY.timeCapMin);
  const staleMin = meme
    ? policyNum(config?.memeStaleMin, POLICY.memeStaleMin)
    : policyNum(config?.staleMin, POLICY.staleMin);
  const speed = leverageHurry(position.leverage);
  const hurriedCap = timeCap * (speed < 1 ? Math.max(speed, 0.5) : 1);
  const hurriedStale = staleMin * speed;
  const hard = exitReason(position, nowMs, hurriedCap);
  if (hard === "stop" || hard === "risk-off") return { exit: hard };
  const r = rMultiple(position);
  const ageMin = positionAgeMin(position, nowMs);
  const stale = ageMin >= hurriedStale && r < 0.15;
  const soft = hard === "target" || hard === "trail" || hard === "time" || stale;
  if (soft && pnlPct > 0 && !clears) return { feeHold: true };
  if (stale) return { exit: "time" };
  if (hard) return { exit: hard };

  const beR = policyNum(config?.beR, POLICY.beR) * speed;
  const scaleAt = policyNum(config?.scaleAtR, POLICY.scaleAtR) * speed;
  const lockAt = policyNum(config?.lockAtR, POLICY.lockAtR) * (speed < 1 ? Math.min(speed + 0.2, 1) : 1);
  const lockProfit = policyNum(config?.lockProfitR, POLICY.lockProfitR);
  const risk = Math.abs(position.entryPrice - (position.initialStop || position.stopPrice));
  const lockR = r >= lockAt ? lockProfit : 0.05;
  let be = position.side === "long" ? position.entryPrice + risk * lockR : position.entryPrice - risk * lockR;
  const hurdle = feeHurdlePct(position.mint, position.symbol, position.leverage ?? 1);
  if (hurdle > 0 && clears) {
    const floor = priceFromEntry(position.entryPrice, position.side, hurdle, "target");
    be = position.side === "long" ? Math.max(be, floor) : Math.min(be, floor);
  }
  if (r >= beR && (hurdle === 0 || clears)) {
    const tighter = position.side === "long" ? Math.max(position.stopPrice, be) : Math.min(position.stopPrice, be);
    if (position.side === "long" ? tighter > position.stopPrice : tighter < position.stopPrice) {
      if (r >= scaleAt && !position.scaled) return { nextStop: tighter, scale: true };
      return { nextStop: tighter };
    }
  }

  if (r >= scaleAt && !position.scaled && (hurdle === 0 || clears)) return { scale: true };
  return {};
}
