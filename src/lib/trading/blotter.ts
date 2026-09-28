import type { Trade, TradeReason } from "@/lib/types";

const SELL_WHY: Record<TradeReason, string> = {
  breakout: "The price broke higher",
  reclaim: "The price recovered",
  fade: "The price was falling",
  stop: "It fell to the loss limit",
  target: "It hit the profit goal",
  trail: "It gave back some of the gain",
  time: "It was held too long",
  manual: "You closed it",
  "risk-off": "The market looked risky",
};

const BUY_WHY: Record<TradeReason, string> = {
  breakout: "Bought because the price broke higher",
  reclaim: "Bought because the price recovered",
  fade: "Bought because the price was falling",
  stop: "Bought",
  target: "Bought",
  trail: "Bought",
  time: "Bought",
  manual: "You bought it",
  "risk-off": "Bought",
};

export interface ExecutionLine {
  id: string;
  verb: "Bought" | "Sold" | "Sold part";
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
  /** True only when this buy still matches a position in the book. */
  stillOpen: boolean;
}

/** Every stored fill. A past buy is not an open position. */
export function tradesForLog(trades: Trade[]): Trade[] {
  return trades;
}

/**
 * A buy is still open only when a position of that coin is in the book now.
 * Extra buys with no position stay closed, even if a sell row was never saved.
 */
export function stillOpenIds(trades: Trade[], positions: { mint: string }[]): Set<string> {
  const ordered = [...trades].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const stacks = new Map<string, string[]>();
  for (const trade of ordered) {
    const stack = stacks.get(trade.mint) ?? [];
    if (trade.action === "open") stack.push(trade.id);
    else if (!trade.note.startsWith("Scale ")) stack.pop();
    stacks.set(trade.mint, stack);
  }
  const left = new Map<string, number>();
  for (const position of positions) left.set(position.mint, (left.get(position.mint) ?? 0) + 1);
  const open = new Set<string>();
  for (const [mint, ids] of stacks) {
    const count = left.get(mint) ?? 0;
    if (count <= 0) continue;
    for (const id of ids.slice(-count)) open.add(id);
  }
  return open;
}

export function logHeadline(recordCount: number, openNow: number): string {
  const open = openNow === 0 ? "Nothing open right now" : openNow === 1 ? "1 open right now" : `${openNow} open right now`;
  const history = recordCount === 1 ? "1 record in the history" : `${recordCount} records in the history`;
  return `${open} · ${history}`;
}

export function sizeText(qty: number): string {
  if (!Number.isFinite(qty)) return "—";
  const abs = Math.abs(qty);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return qty.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function executionLine(trade: Trade, stillOpen = false): ExecutionLine {
  const partial = trade.action === "close" && trade.note.startsWith("Scale ");
  const verb = trade.action === "open" ? "Bought" : partial ? "Sold part" : "Sold";
  return {
    id: trade.id,
    verb: trade.side === "short" && verb === "Bought" ? "Bought" : verb,
    symbol: trade.symbol,
    side: trade.side,
    qty: trade.qty,
    price: trade.price,
    notionalUsd: trade.qty * trade.price,
    pnlUsd: trade.pnlUsd,
    pnlPct: trade.pnlPct,
    why: partial ? scaleWhy(trade.note) : trade.action === "open" ? buyWhy(trade) : sellWhy(trade),
    at: trade.at,
    signature: trade.signature,
    stillOpen: trade.action === "open" && stillOpen,
  };
}

function buyWhy(trade: Trade): string {
  const base = BUY_WHY[trade.reason] ?? "Bought";
  return trade.side === "short" ? base.replace(/^Bought/, "Bet against") : base;
}

function sellWhy(trade: Trade): string {
  const base = SELL_WHY[trade.reason] ?? "Sold";
  const entry = trade.note.match(/exit from ([a-z-]+) entry/i)?.[1];
  if (!entry) return base;
  const entryLabel = SELL_WHY[entry as TradeReason] ?? entry;
  return `${base}. It was bought because ${entryLabel.charAt(0).toLowerCase()}${entryLabel.slice(1)}`;
}

function scaleWhy(note: string): string {
  const percent = note.match(/Scale\s+(\d+)%/i)?.[1];
  return percent ? `Sold ${percent}% and kept the rest` : "Sold part and kept the rest";
}
