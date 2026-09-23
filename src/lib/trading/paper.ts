import type { AppState, Position, Signal, Trade } from "@/lib/types";
import { id } from "@/lib/utils";
import { MIN_TICKET_USD, markPosition, unrealizedPnl } from "./risk";

const SLIP_BPS = 8;

export function fillPrice(signalPrice: number, side: "long" | "short", action: "open" | "close"): number {
  const slip = signalPrice * (SLIP_BPS / 10_000);
  if (action === "open") return side === "long" ? signalPrice + slip : signalPrice - slip;
  return side === "long" ? signalPrice - slip : signalPrice + slip;
}

export function positionValue(position: Position): number {
  if (position.side === "long") return position.qty * position.markPrice;
  return position.qty * (2 * position.entryPrice - position.markPrice);
}

export function exitProceeds(position: Pick<Position, "side" | "qty" | "entryPrice">, fill: number, pnlUsd: number): number {
  if (position.side === "long") return position.qty * fill;
  return position.qty * position.entryPrice + pnlUsd;
}

export function openPosition(state: AppState, signal: Signal, qty: number): AppState {
  const price = fillPrice(signal.price, signal.side, "open");
  const room = state.portfolio.cashUsd * 0.98;
  let filledQty = qty;
  let notional = filledQty * price;
  if (notional > room) {
    if (room < MIN_TICKET_USD) return state;
    filledQty = room / price;
    notional = filledQty * price;
  }
  qty = filledQty;

  const stop =
    signal.side === "long" ? price * (1 - signal.stopPct / 100) : price * (1 + signal.stopPct / 100);
  const target =
    signal.side === "long" ? price * (1 + signal.targetPct / 100) : price * (1 - signal.targetPct / 100);

  const position: Position = {
    id: id("pos"),
    mint: signal.mint,
    symbol: signal.symbol,
    poolAddress: signal.poolAddress,
    sector: signal.sector ?? "Unknown",
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
    initialStop: stop,
    scaled: false,
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
  const proceeds = exitProceeds(pos, price, pnl.usd);
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
  const equity = state.portfolio.cashUsd + positions.reduce((acc, p) => acc + positionValue(p), 0);
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

export function updateStop(state: AppState, positionId: string, stopPrice: number): AppState {
  return {
    ...state,
    positions: state.positions.map((p) => (p.id === positionId ? { ...p, stopPrice, lastUpdate: new Date().toISOString() } : p)),
  };
}

export function scaleOut(state: AppState, positionId: string, fraction = 0.5): AppState {
  const pos = state.positions.find((p) => p.id === positionId);
  if (!pos || pos.scaled || fraction <= 0 || fraction >= 1) return state;
  const qty = pos.qty * fraction;
  if (qty <= 0) return state;
  const price = fillPrice(pos.markPrice, pos.side, "close");
  const marked = markPosition({ ...pos, markPrice: price, qty }, price);
  const pnl = unrealizedPnl(marked);
  const proceeds = exitProceeds({ ...pos, qty }, price, pnl.usd);
  const remain = pos.qty - qty;
  const trade: Trade = {
    id: id("tr"),
    mint: pos.mint,
    symbol: pos.symbol,
    side: pos.side,
    action: "close",
    qty,
    price,
    pnlUsd: pnl.usd,
    pnlPct: pnl.pct,
    reason: "target",
    at: new Date().toISOString(),
    note: `Scale ${Math.round(fraction * 100)}% at +${((price / pos.entryPrice - 1) * 100 * (pos.side === "long" ? 1 : -1)).toFixed(2)}% — let the rest run`,
  };
  return {
    ...state,
    portfolio: {
      ...state.portfolio,
      cashUsd: state.portfolio.cashUsd + proceeds,
      realizedPnlUsd: state.portfolio.realizedPnlUsd + pnl.usd,
      tradeCount: state.portfolio.tradeCount + 1,
    },
    positions: state.positions.map((p) =>
      p.id === positionId
        ? { ...p, qty: remain, notional: remain * p.markPrice, scaled: true, lastUpdate: new Date().toISOString() }
        : p,
    ),
    trades: [trade, ...state.trades].slice(0, 250),
  };
}

export function flattenBook(state: AppState, reason: Trade["reason"] = "manual"): AppState {
  return state.positions.reduce((acc, pos) => closePosition(acc, pos.id, pos.markPrice, reason), state);
}

export function pushEquity(state: AppState): AppState {
  const point = { t: new Date().toISOString(), equity: state.portfolio.equityUsd };
  const curve = [...state.equityCurve, point];
  const trimmed = curve.length > 360 ? curve.slice(curve.length - 360) : curve;
  return { ...state, equityCurve: trimmed };
}
