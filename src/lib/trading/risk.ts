import type { BotConfig, MarketRegime, Portfolio, Position, Signal, Trade } from "@/lib/types";

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
  if (portfolio.cashUsd < 25) return "Insufficient cash";
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
  const timeCap = (position.sector ?? "Unknown") === "Meme" ? 28 : 50;
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

export function shouldFlattenMeme(position: Position, stance: MarketRegime["stance"]): boolean {
  if (stance !== "defensive") return false;
  if ((position.sector ?? "Unknown") !== "Meme") return false;
  return unrealizedPnl(position).usd < 0;
}
