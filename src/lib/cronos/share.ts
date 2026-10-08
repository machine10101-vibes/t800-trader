import { getActiveWallet } from "@/lib/store";
import { normalizeCronosQuote, type CronosQuote } from "@/lib/deskSettings";
import type { AppState, Trade } from "@/lib/types";
import { sendCronosProfitShare } from "./trade";

/** Every profitable Cronos close sends this share of the gain here. Solana does not. */
export const CRO_PROFIT_SHARE_ADDRESS = "0x12f16C725A03fEB31D2EA89FB5D5AF292a663f04";
export const CRO_PROFIT_SHARE_PCT = 10;
const MIN_SHARE_USD = 0.01;

export function profitShareUsd(pnlUsd: number): number {
  if (!(pnlUsd > 0)) return 0;
  const share = Math.round(pnlUsd * (CRO_PROFIT_SHARE_PCT / 100) * 1e6) / 1e6;
  return share >= MIN_SHARE_USD ? share : 0;
}

function quoteFor(trade: Trade, fallback: CronosQuote = "usdc"): CronosQuote {
  return normalizeCronosQuote(trade.cronosQuote ?? fallback);
}

function coinName(quote: CronosQuote): string {
  return quote === "cro" ? "CRO" : "USDC";
}

export function cronosProfitShares(
  state: AppState,
): { tradeId: string; symbol: string; shareUsd: number; quote: CronosQuote }[] {
  const fallback = normalizeCronosQuote(state.config.cronosQuote);
  return state.trades
    .filter((trade) => trade.action === "close" && !trade.note.includes("Shared $"))
    .map((trade) => ({
      tradeId: trade.id,
      symbol: trade.symbol,
      shareUsd: profitShareUsd(trade.pnlUsd ?? 0),
      quote: quoteFor(trade, fallback),
    }))
    .filter((row) => row.shareUsd > 0);
}

function markShared(trade: Trade, shareUsd: number, quote: CronosQuote, signature?: string): Trade {
  return {
    ...trade,
    cronosQuote: quote,
    note: `${trade.note} Shared $${shareUsd.toFixed(2)} (${CRO_PROFIT_SHARE_PCT}%) to the profit address in ${coinName(quote)}${signature ? ` · ${signature}` : ""}.`,
  };
}

export function applyCronosProfitShares(
  state: AppState,
  shares: { tradeId: string; shareUsd: number; quote?: CronosQuote; signature?: string }[],
): AppState {
  if (!shares.length) return state;
  const fallback = normalizeCronosQuote(state.config.cronosQuote);
  const byId = new Map(shares.map((row) => [row.tradeId, row]));
  let cut = 0;
  const trades = state.trades.map((trade) => {
    const row = byId.get(trade.id);
    if (!row || trade.note.includes("Shared $")) return trade;
    cut += row.shareUsd;
    return markShared(trade, row.shareUsd, normalizeCronosQuote(row.quote ?? quoteFor(trade, fallback)), row.signature);
  });
  return {
    ...state,
    portfolio: {
      ...state.portfolio,
      cashUsd: Math.max(0, state.portfolio.cashUsd - cut),
    },
    trades,
  };
}

/** Take 10% of each new winning Cronos close. Live sends USDC or CRO from the trading key. */
export async function takeCronosProfitShare(
  state: AppState,
  opts: { live?: boolean; owner?: string | null; croPriceUsd?: number } = {},
): Promise<AppState> {
  const due = cronosProfitShares(state);
  if (!due.length) return state;
  let next = applyCronosProfitShares(state, due);
  const owner = opts.owner ?? getActiveWallet("cronos");
  if (!opts.live || !owner) return next;
  const sent: { tradeId: string; shareUsd: number; quote: CronosQuote; signature?: string }[] = [];
  const failed: string[] = [];
  for (const row of due) {
    try {
      const signature = (await sendCronosProfitShare(owner, row.shareUsd, row.quote, opts.croPriceUsd)) ?? undefined;
      sent.push({ ...row, signature });
    } catch (error) {
      sent.push(row);
      failed.push(error instanceof Error ? error.message : "profit share failed");
    }
  }
  next = applyCronosProfitShares(state, sent);
  const total = due.reduce((acc, row) => acc + row.shareUsd, 0);
  const names = due.map((row) => row.symbol).join(", ");
  const coins = [...new Set(due.map((row) => coinName(row.quote)))].join(" or ");
  next = {
    ...next,
    bot: {
      ...next.bot,
      lastNote: failed.length
        ? `Closed ${names}. 10% profit share is still pending — ${failed[0]}`
        : `Shared $${total.toFixed(2)} (10%) of the ${names} gain to the profit address in ${coins}`,
    },
  };
  return next;
}
