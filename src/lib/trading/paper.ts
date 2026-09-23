import type { AppState, Position, Signal, Trade } from "@/lib/types";
import { id } from "@/lib/utils";
import { markPosition, unrealizedPnl } from "./risk";

const SLIP_BPS = 8;

export function fillPrice(signalPrice: number, side: "long" | "short", action: "open" | "close"): number {
  const slip = signalPrice * (SLIP_BPS / 10_000);
  if (action === "open") return side === "long" ? signalPrice + slip : signalPrice - slip;
  return side === "long" ? signalPrice - slip : signalPrice + slip;
}

export function openPosition(state: AppState, signal: Signal, qty: number): AppState {
  const price = fillPrice(signal.price, signal.side, "open");
  const notional = qty * price;
  if (notional > state.portfolio.cashUsd) return state;

  const stop =
    signal.side === "long" ? price * (1 - signal.stopPct / 100) : price * (1 + signal.stopPct / 100);
  const target =
    signal.side === "long" ? price * (1 + signal.targetPct / 100) : price * (1 - signal.targetPct / 100);

  const position: Position = {
    id: id("pos"),
    mint: signal.mint,
    symbol: signal.symbol,
    poolAddress: signal.poolAddress,
    side: signal.side,
    qty,
    entryPrice: price,
    markPrice: price,
    stopPrice: stop,
    targetPrice: target,
    openedAt: new Date().toISOString(),
    lastUpdate: new Date().toISOString(),
    reason: signal.reason,
    researchScore: signal.researchScore,
    highWater: price,
    lowWater: price,
    notional,
  };

  const trade: Trade = {
    id: id("tr"),
    mint: signal.mint,
    symbol: signal.symbol,
    side: signal.side,
    action: "open",
    qty,
    price,
    pnlUsd: null,
    pnlPct: null,
    reason: signal.reason,
    at: new Date().toISOString(),
    note: signal.thesis,
  };

  return {
    ...state,
    portfolio: {
      ...state.portfolio,
      cashUsd: state.portfolio.cashUsd - notional,
      tradeCount: state.portfolio.tradeCount + 1,
    },
    positions: [position, ...state.positions],
    trades: [trade, ...state.trades].slice(0, 250),
  };
}

export function closePosition(state: AppState, positionId: string, priceHint: number, reason: Trade["reason"]): AppState {
  const pos = state.positions.find((p) => p.id === positionId);
  if (!pos) return state;
  const price = fillPrice(priceHint, pos.side, "close");
  const marked = markPosition({ ...pos, markPrice: price }, price);
  const pnl = unrealizedPnl(marked);
  const proceeds = pos.qty * price;
  const trade: Trade = {
    id: id("tr"),
    mint: pos.mint,
    symbol: pos.symbol,
    side: pos.side,
    action: "close",
    qty: pos.qty,
    price,
    pnlUsd: pnl.usd,
    pnlPct: pnl.pct,
    reason,
    at: new Date().toISOString(),
    note: `${reason} exit from ${pos.reason} entry`,
  };

  const realized = state.portfolio.realizedPnlUsd + pnl.usd;
  const winCount = state.portfolio.winCount + (pnl.usd >= 0 ? 1 : 0);
  const lossCount = state.portfolio.lossCount + (pnl.usd < 0 ? 1 : 0);

  return {
    ...state,
    portfolio: {
      ...state.portfolio,
      cashUsd: state.portfolio.cashUsd + proceeds,
      realizedPnlUsd: realized,
      winCount,
      lossCount,
      tradeCount: state.portfolio.tradeCount + 1,
    },
    positions: state.positions.filter((p) => p.id !== positionId),
    trades: [trade, ...state.trades].slice(0, 250),
  };
}

export function markBook(state: AppState, prices: Map<string, number>): AppState {
  const positions = state.positions.map((p) => {
    const px = prices.get(p.mint) ?? p.markPrice;
    return markPosition(p, px);
  });
  const unreal = positions.reduce((acc, p) => acc + unrealizedPnl(p).usd, 0);
  const equity = state.portfolio.cashUsd + positions.reduce((acc, p) => acc + p.qty * p.markPrice, 0);
  const peak = Math.max(state.portfolio.peakEquity, equity);
  return {
    ...state,
    positions,
    portfolio: {
      ...state.portfolio,
      equityUsd: equity,
      peakEquity: peak,
      unrealizedPnlUsd: unreal,
      dayPnlUsd: equity - state.portfolio.dayStartEquity,
    },
  };
}

export function pushEquity(state: AppState): AppState {
  const point = { t: new Date().toISOString(), equity: state.portfolio.equityUsd };
  const curve = [...state.equityCurve, point];
  const trimmed = curve.length > 360 ? curve.slice(curve.length - 360) : curve;
  return { ...state, equityCurve: trimmed };
}
