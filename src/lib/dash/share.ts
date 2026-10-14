import { getActiveWallet } from "@/lib/store";
import { sendSolProfitShare } from "@/lib/solana/authorize";
import { usageFeeUsd } from "@/lib/trading/fees";
import type { AppState, Trade } from "@/lib/types";
import { normalizeDashQuote, type DashQuote } from "@/lib/deskSettings";

export const DASH_PROFIT_SHARE_PCT = 10;

export function dashProfitShareUsd(pnlUsd: number): number {
  return usageFeeUsd(pnlUsd);
}

function quoteFor(trade: Trade, fallback: DashQuote): DashQuote {
  return normalizeDashQuote(trade.dashQuote ?? fallback);
}

export function dashProfitShares(state: AppState): { tradeId: string; symbol: string; shareUsd: number; quote: DashQuote }[] {
  const fallback = normalizeDashQuote(state.config.dashQuote);
  return state.trades
    .filter((trade) => trade.action === "close" && !trade.note.includes("Shared $"))
    .map((trade) => ({
      tradeId: trade.id,
      symbol: trade.symbol,
      shareUsd: dashProfitShareUsd(trade.pnlUsd ?? 0),
      quote: quoteFor(trade, fallback),
    }))
    .filter((row) => row.shareUsd > 0);
}

function markShared(trade: Trade, shareUsd: number, quote: DashQuote, signature?: string): Trade {
  const coin = quote === "dash" ? "DASH" : "USDT";
  return {
    ...trade,
    dashQuote: quote,
    note: `${trade.note} Shared $${shareUsd.toFixed(2)} (${DASH_PROFIT_SHARE_PCT}%) to the profit address in ${coin}${signature ? ` · ${signature}` : ""}.`,
  };
}

export function applyDashProfitShares(
  state: AppState,
  shares: { tradeId: string; shareUsd: number; quote?: DashQuote; signature?: string }[],
): AppState {
  if (!shares.length) return state;
  const fallback = normalizeDashQuote(state.config.dashQuote);
  const byId = new Map(shares.map((row) => [row.tradeId, row]));
  let cut = 0;
  const trades = state.trades.map((trade) => {
    const row = byId.get(trade.id);
    if (!row || trade.note.includes("Shared $")) return trade;
    cut += row.shareUsd;
    return markShared(trade, row.shareUsd, normalizeDashQuote(row.quote ?? quoteFor(trade, fallback)), row.signature);
  });
  return {
    ...state,
    portfolio: { ...state.portfolio, cashUsd: Math.max(0, state.portfolio.cashUsd - cut) },
    trades,
  };
}

/** USDT tickets pay USDC. DASH tickets pay SOL of the same dollars. Both go to the Solana profit address. */
export async function takeDashProfitShare(
  state: AppState,
  opts: { live?: boolean; owner?: string | null; dashPriceUsd?: number } = {},
): Promise<AppState> {
  const due = dashProfitShares(state);
  if (!due.length) return state;
  let next = applyDashProfitShares(state, due);
  const owner = opts.owner ?? getActiveWallet("solana");
  if (!opts.live || !owner) return next;
  const sent: { tradeId: string; shareUsd: number; quote: DashQuote; signature?: string }[] = [];
  const failed: string[] = [];
  for (const row of due) {
    try {
      const signature =
        (await sendSolProfitShare(owner, row.shareUsd, opts.dashPriceUsd ?? 0, row.quote === "dash" ? "sol" : "usdc")) ??
        undefined;
      sent.push({ ...row, signature });
    } catch (error) {
      sent.push(row);
      failed.push(error instanceof Error ? error.message : "profit share failed");
    }
  }
  next = applyDashProfitShares(state, sent);
  const total = due.reduce((acc, row) => acc + row.shareUsd, 0);
  const names = due.map((row) => row.symbol).join(", ");
  next = {
    ...next,
    bot: {
      ...next.bot,
      lastNote: failed.length
        ? `Closed ${names}. 10% profit share is still pending — ${failed[0]}`
        : `Shared $${total.toFixed(2)} (10%) of the ${names} gain to the profit address`,
    },
  };
  return next;
}
