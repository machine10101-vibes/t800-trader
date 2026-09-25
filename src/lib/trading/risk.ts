import type { BotConfig, MarketRegime, Portfolio, Position, Signal, Trade } from "@/lib/types";
import { PERP_RENT_SOL } from "./leverage";

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
  const { equity, price, stopPct, config, regime, researchScore } = args;
  if (price <= 0 || stopPct <= 0) return { qty: 0, notional: 0 };

  let riskPct = config.maxRiskPerTradePct;
  if (regime.stance === "defensive") riskPct *= 0.45;
  if (regime.stance === "mixed") riskPct *= 0.75;
  if (researchScore !== null && researchScore < 55) riskPct *= 0.7;
  if (researchScore !== null && researchScore > 72) riskPct *= 1.1;
  if ((args.confidence ?? 60) >= 78) riskPct *= 1.08;
  if ((args.lossStreak ?? 0) >= 2) riskPct *= 0.55;
  if ((args.dayUsed ?? 0) >= 0.7) riskPct *= 0.45;

  const riskUsd = equity * (riskPct / 100);
  const stopFrac = stopPct / 100;
  const capPct = sizeCapPct(equity, regime.stance);
  const raw = riskUsd / stopFrac;
  const floor = isMicroBook(equity) ? Math.min(equity * 0.45, equity * capPct) : 0;
  const notional = Math.min(Math.max(raw, floor), equity * capPct);
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
}): string | null {
  const { positions, signal, config, portfolio, trades = [], stance } = args;
  if (positions.length >= config.maxPositions) return "Max positions reached";
  if (config.microOneTicket !== false && isMicroBook(portfolio.equityUsd) && positions.length >= 1) {
    return "Micro book rides one ticket";
  }
  if (positions.some((p) => p.mint === signal.mint)) return "Already in this mint";
  if (dayLossBreached(portfolio, config)) return "Daily loss limit";
  if (!config.allowShorts && signal.side === "short") return "Shorts disabled";
  const minCash = args.minCashUsd ?? MIN_TRADE_USD;
  if (portfolio.cashUsd < minCash) return "Insufficient cash";
  if (stance === "defensive" && signal.side === "short") return "No shorts in a defensive tape";
  const breakoutScore = policyNum(config.defensiveBreakoutScore, POLICY.defensiveBreakoutScore);
  if (stance === "defensive" && signal.reason === "breakout" && (signal.researchScore ?? 0) < breakoutScore) {
    return `Breakouts need a ${breakoutScore}+ score when defensive`;
  }
  const sector = signal.sector ?? "Unknown";
  const sameSector = positions.filter((p) => (p.sector ?? "Unknown") === sector).length;
  const sectorCap = Math.max(1, policyNum(config.maxPerSector, POLICY.maxPerSector));
  if (sameSector >= sectorCap) return `Sector cap of ${sectorCap} reached for ${sector}`;
  if (sector === "Meme" && positions.filter((p) => p.sector === "Meme").length >= 1 && stance !== "risk-on") {
    return "Meme cluster capped off risk-on";
  }
  const lastStop = trades.find(
    (t) => t.mint === signal.mint && t.action === "close" && (t.reason === "stop" || t.reason === "time" || t.reason === "risk-off"),
  );
  const cooldownMs = Math.max(0, policyNum(config.cooldownMinutes, POLICY.cooldownMinutes)) * 60_000;
  if (cooldownMs > 0 && lastStop && Date.now() - Date.parse(lastStop.at) < cooldownMs) {
    return "Cooldown after a stop/time-out on this mint";
  }
  const streakCap = policyNum(config.lossStreakPause, POLICY.lossStreakPause);
  if (streakCap > 0 && consecutiveLosses(trades) >= streakCap) return `Cooling after ${streakCap} straight losses`;
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
  if (lev > 1 && position.side === "long") {
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

export function unrealizedPnl(position: Position): { usd: number; pct: number } {
  const dir = position.side === "long" ? 1 : -1;
  const pct = ((position.markPrice - position.entryPrice) / position.entryPrice) * 100 * dir;
  const usd = position.qty * position.entryPrice * (pct / 100);
  return { usd, pct };
}

export function exitReason(
  position: Position,
  nowMs = Date.now(),
  timeCapMin?: number,
): "stop" | "target" | "trail" | "time" | "risk-off" | null {
  const { usd } = unrealizedPnl(position);
  const ageMin = (nowMs - Date.parse(position.openedAt)) / 60_000;
  const fallback = (position.sector ?? "Unknown") === "Meme" ? POLICY.memeTimeCapMin : POLICY.timeCapMin;
  const timeCap = policyNum(timeCapMin, fallback);
  if (position.side === "long") {
    if (position.markPrice <= position.stopPrice) return "stop";
    if (position.markPrice >= position.targetPrice) return "target";
    const locked = position.entryPrice + (position.targetPrice - position.entryPrice) * 0.55;
    if (usd > 0 && position.highWater >= locked && position.markPrice < locked) return "trail";
  } else {
    if (position.markPrice >= position.stopPrice) return "stop";
    if (position.markPrice <= position.targetPrice) return "target";
    const locked = position.entryPrice - (position.entryPrice - position.targetPrice) * 0.55;
    if (usd > 0 && position.lowWater <= locked && position.markPrice > locked) return "trail";
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
  if (position.side !== "long") return false;
  if (rMultiple(position) >= 0.25) return false;
  return m15 <= -1.2 && m5 <= -0.6;
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

export function managePosition(
  position: Position,
  nowMs = Date.now(),
  config?: Partial<BotConfig>,
): { nextStop?: number; exit?: "stop" | "target" | "trail" | "time" | "risk-off"; scale?: boolean } {
  const meme = (position.sector ?? "Unknown") === "Meme";
  const timeCap = meme
    ? policyNum(config?.memeTimeCapMin, POLICY.memeTimeCapMin)
    : policyNum(config?.timeCapMin, POLICY.timeCapMin);
  const staleMin = meme
    ? policyNum(config?.memeStaleMin, POLICY.memeStaleMin)
    : policyNum(config?.staleMin, POLICY.staleMin);
  const hard = exitReason(position, nowMs, timeCap);
  if (hard && hard !== "time") return { exit: hard };
  const r = rMultiple(position);
  const ageMin = (nowMs - Date.parse(position.openedAt)) / 60_000;
  if (ageMin >= staleMin && r < 0.15) return { exit: "time" };
  if (hard) return { exit: hard };

  const beR = policyNum(config?.beR, POLICY.beR);
  const scaleAt = policyNum(config?.scaleAtR, POLICY.scaleAtR);
  const lockAt = policyNum(config?.lockAtR, POLICY.lockAtR);
  const lockProfit = policyNum(config?.lockProfitR, POLICY.lockProfitR);
  const risk = Math.abs(position.entryPrice - (position.initialStop || position.stopPrice));
  const lockR = r >= lockAt ? lockProfit : 0.05;
  const be = position.side === "long" ? position.entryPrice + risk * lockR : position.entryPrice - risk * lockR;
  if (r >= beR) {
    const tighter = position.side === "long" ? Math.max(position.stopPrice, be) : Math.min(position.stopPrice, be);
    if (position.side === "long" ? tighter > position.stopPrice : tighter < position.stopPrice) {
      if (r >= scaleAt && !position.scaled) return { nextStop: tighter, scale: true };
      return { nextStop: tighter };
    }
  }

  if (r >= scaleAt && !position.scaled) return { scale: true };
  return {};
}
