import type { BotConfig, MarketRegime, Portfolio, Position, Signal, Trade } from "@/lib/types";

/** Smallest wallet the desk will arm and open against. */
export const MIN_TRADE_USD = 5;
/** Smallest ticket the execution loop will send. */
export const MIN_TICKET_USD = 1;
/** Books below this use micro sizing so a $5–$6 wallet can actually fill. */
export const MICRO_BOOK_USD = 50;

export function isMicroBook(equity: number): boolean {
  return equity > 0 && equity < MICRO_BOOK_USD;
}

export function cashConcentration(equity: number): number {
  return isMicroBook(equity) ? 0.92 : 0.35;
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

const COOLDOWN_MS = 20 * 60_000;

export function canOpen(args: {
  positions: Position[];
  signal: Signal;
  config: BotConfig;
  portfolio: Portfolio;
  trades?: Trade[];
  stance?: MarketRegime["stance"];
}): string | null {
  const { positions, signal, config, portfolio, trades = [], stance } = args;
  if (positions.length >= config.maxPositions) return "Max positions reached";
  if (positions.some((p) => p.mint === signal.mint)) return "Already in this mint";
  if (dayLossBreached(portfolio, config)) return "Daily loss limit";
  if (!config.allowShorts && signal.side === "short") return "Shorts disabled";
  if (portfolio.cashUsd < MIN_TRADE_USD) return "Insufficient cash";
  if (stance === "defensive" && signal.side === "short") return "No shorts in a defensive tape";
  if (stance === "defensive" && signal.reason === "breakout" && (signal.researchScore ?? 0) < 70) {
    return "Breakouts need a 70+ score when defensive";
  }
  const sector = signal.sector ?? "Unknown";
  const sameSector = positions.filter((p) => (p.sector ?? "Unknown") === sector).length;
  if (sameSector >= 2) return `Already two ${sector} tickets`;
  if (sector === "Meme" && positions.filter((p) => p.sector === "Meme").length >= 1 && stance !== "risk-on") {
    return "Meme cluster capped off risk-on";
  }
  const lastStop = trades.find((t) => t.mint === signal.mint && t.action === "close" && (t.reason === "stop" || t.reason === "time"));
  if (lastStop && Date.now() - Date.parse(lastStop.at) < COOLDOWN_MS) {
    return "Cooldown after a stop/time-out on this mint";
  }
  if (consecutiveLosses(trades) >= 3) return "Cooling after a three-loss streak";
  if (dayLossUsedPct(portfolio, config) >= 0.9) return "Protect remaining day budget";
  if (signal.confidence < (signal.sector === "Meme" || signal.sector === "Unknown" ? 62 : 58)) {
    return "Confidence below the quality floor";
  }
  return null;
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

export function exitReason(position: Position, nowMs = Date.now()): "stop" | "target" | "trail" | "time" | "risk-off" | null {
  const { usd } = unrealizedPnl(position);
  const ageMin = (nowMs - Date.parse(position.openedAt)) / 60_000;
  const timeCap = (position.sector ?? "Unknown") === "Meme" ? 40 : 120;
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
): { nextStop?: number; exit?: "stop" | "target" | "trail" | "time" | "risk-off"; scale?: boolean } {
  const hard = exitReason(position, nowMs);
  if (hard && hard !== "time") return { exit: hard };
  const r = rMultiple(position);
  const ageMin = (nowMs - Date.parse(position.openedAt)) / 60_000;
  const staleMin = (position.sector ?? "Unknown") === "Meme" ? 22 : 45;
  if (ageMin >= staleMin && r < 0.15) return { exit: "time" };
  if (hard) return { exit: hard };

  const risk = Math.abs(position.entryPrice - (position.initialStop || position.stopPrice));
  const lockR = r >= 1.5 ? 0.45 : 0.05;
  const be =
    position.side === "long" ? position.entryPrice + risk * lockR : position.entryPrice - risk * lockR;
  if (r >= 0.8) {
    const tighter =
      position.side === "long" ? Math.max(position.stopPrice, be) : Math.min(position.stopPrice, be);
    if (position.side === "long" ? tighter > position.stopPrice : tighter < position.stopPrice) {
      if (r >= 1 && !position.scaled) return { nextStop: tighter, scale: true };
      return { nextStop: tighter };
    }
  }

  if (r >= 1 && !position.scaled) return { scale: true };
  return {};
}
