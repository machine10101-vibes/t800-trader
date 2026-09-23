import type { BookStats, EquityPoint, Portfolio, Trade } from "@/lib/types";
import { maxDrawdownPct } from "./risk";

export function bookStats(trades: Trade[], portfolio: Portfolio, curve: EquityPoint[]): BookStats {
  const closed = trades.filter((t) => t.action === "close" && t.pnlUsd !== null);
  const wins = closed.filter((t) => (t.pnlUsd ?? 0) >= 0);
  const losses = closed.filter((t) => (t.pnlUsd ?? 0) < 0);
  const winSum = wins.reduce((a, t) => a + (t.pnlUsd ?? 0), 0);
  const lossSum = Math.abs(losses.reduce((a, t) => a + (t.pnlUsd ?? 0), 0));
  const avgWinUsd = wins.length ? winSum / wins.length : 0;
  const avgLossUsd = losses.length ? lossSum / losses.length : 0;
  const wr = closed.length ? wins.length / closed.length : 0;
  const peak = curve.reduce((m, p) => Math.max(m, p.equity), portfolio.peakEquity);
  return {
    closedTrades: closed.length,
    avgWinUsd,
    avgLossUsd,
    expectancyUsd: closed.length ? wr * avgWinUsd - (1 - wr) * avgLossUsd : 0,
    profitFactor: lossSum > 0 ? winSum / lossSum : wins.length ? Number.POSITIVE_INFINITY : null,
    maxDrawdownPct: maxDrawdownPct(peak, portfolio.equityUsd),
  };
}
