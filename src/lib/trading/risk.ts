import type { BotConfig, MarketRegime, Portfolio, Position, Signal } from "@/lib/types";

export function dayLossBreached(portfolio: Portfolio, config: BotConfig): boolean {
  const dd = ((portfolio.dayStartEquity - portfolio.equityUsd) / Math.max(portfolio.dayStartEquity, 1)) * 100;
  return dd >= config.dailyLossLimitPct;
}

export function maxDrawdownPct(peak: number, equity: number): number {
  if (peak <= 0) return 0;
  return Math.max(0, ((peak - equity) / peak) * 100);
}

export function sizePosition(args: {
  equity: number;
  price: number;
  stopPct: number;
  config: BotConfig;
  regime: MarketRegime;
  researchScore: number | null;
}): { qty: number; notional: number } {
  const { equity, price, stopPct, config, regime, researchScore } = args;
  if (price <= 0 || stopPct <= 0) return { qty: 0, notional: 0 };

  let riskPct = config.maxRiskPerTradePct;
  if (regime.stance === "defensive") riskPct *= 0.45;
  if (regime.stance === "mixed") riskPct *= 0.75;
  if (researchScore !== null && researchScore < 55) riskPct *= 0.7;
  if (researchScore !== null && researchScore > 72) riskPct *= 1.1;

  const riskUsd = equity * (riskPct / 100);
  const stopFrac = stopPct / 100;
  const capPct = regime.stance === "defensive" ? 0.1 : regime.stance === "mixed" ? 0.16 : 0.22;
  const notional = Math.min(riskUsd / stopFrac, equity * capPct);
  const qty = notional / price;
  return { qty, notional };
}

export function canOpen(args: {
  positions: Position[];
  signal: Signal;
  config: BotConfig;
  portfolio: Portfolio;
}): string | null {
  const { positions, signal, config, portfolio } = args;
  if (positions.length >= config.maxPositions) return "Max positions reached";
  if (positions.some((p) => p.mint === signal.mint)) return "Already in this mint";
  if (dayLossBreached(portfolio, config)) return "Daily loss limit";
  if (!config.allowShorts && signal.side === "short") return "Shorts disabled";
  if (portfolio.cashUsd < 25) return "Insufficient cash";
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

export function exitReason(position: Position, nowMs = Date.now()): "stop" | "target" | "trail" | "time" | null {
  const { usd } = unrealizedPnl(position);
  const ageMin = (nowMs - Date.parse(position.openedAt)) / 60_000;
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
  if (ageMin > 50) return "time";
  return null;
}
