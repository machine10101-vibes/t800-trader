import type { Trade, TradeReason } from "@/lib/types";

const CLOSE_WHY: Record<TradeReason, string> = {
  breakout: "Breakout",
  reclaim: "Reclaim",
  fade: "Fade",
  stop: "Stop loss",
  target: "Take profit",
  trail: "Trailing stop",
  time: "Time stop",
  manual: "Closed by hand",
  "risk-off": "Risk-off",
};

const OPEN_WHY: Record<TradeReason, string> = {
  breakout: "Opened on a breakout",
  reclaim: "Opened on a reclaim",
  fade: "Opened on a fade",
  stop: "Opened",
  target: "Opened",
  trail: "Opened",
  time: "Opened",
  manual: "Opened by hand",
  "risk-off": "Opened",
};

export interface ExecutionLine {
  id: string;
  verb: "Opened" | "Closed" | "Scaled out";
  symbol: string;
  side: Trade["side"];
  qty: number;
  price: number;
  notionalUsd: number;
  pnlUsd: number | null;
  pnlPct: number | null;
  why: string;
  at: string;
  signature?: string;
}

export interface TradeTally {
  total: number;
  closed: number;
  opened: number;
}

/** Every stored fill. Opens count in the trade total, so the log has to show them too. */
export function tradesForLog(trades: Trade[]): Trade[] {
  return trades;
}

export function tradeTally(trades: Trade[]): TradeTally {
  const closed = trades.filter((trade) => trade.action === "close").length;
  return { total: trades.length, closed, opened: trades.length - closed };
}

export function sizeText(qty: number): string {
  if (!Number.isFinite(qty)) return "—";
  const abs = Math.abs(qty);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return qty.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function executionLine(trade: Trade): ExecutionLine {
  const scaled = trade.action === "close" && trade.note.startsWith("Scale ");
  return {
    id: trade.id,
    verb: trade.action === "open" ? "Opened" : scaled ? "Scaled out" : "Closed",
    symbol: trade.symbol,
    side: trade.side,
    qty: trade.qty,
    price: trade.price,
    notionalUsd: trade.qty * trade.price,
    pnlUsd: trade.pnlUsd,
    pnlPct: trade.pnlPct,
    why: scaled ? scaleWhy(trade.note) : trade.action === "open" ? OPEN_WHY[trade.reason] : closeWhy(trade),
    at: trade.at,
    signature: trade.signature,
  };
}

function closeWhy(trade: Trade): string {
  const base = CLOSE_WHY[trade.reason] ?? trade.reason;
  const entry = trade.note.match(/exit from ([a-z-]+) entry/i)?.[1];
  if (!entry) return base;
  const entryLabel = CLOSE_WHY[entry as TradeReason] ?? entry;
  return `${base} · entered on a ${entryLabel.toLowerCase()}`;
}

function scaleWhy(note: string): string {
  const cleaned = note.replace(/\s*Wallet tx .*$/i, "").trim();
  return cleaned || "Scaled out";
}
