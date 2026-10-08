import { getActiveWallet } from "@/lib/store";
import type { AppState, Trade } from "@/lib/types";
import { sendSolProfitShare } from "./authorize";

/** Every profitable Solana close sends this share of the gain here. Cronos does not. */
export const SOL_PROFIT_SHARE_ADDRESS = "4hjme16Q6nxJXqKynFn5fbM4xswwjXE4v5HcCv64dDkv";
export const SOL_PROFIT_SHARE_PCT = 10;
const MIN_SHARE_USD = 0.01;

/** Dollars to send. Zero on a loss, a scratch, or dust under a cent. */
export function profitShareUsd(pnlUsd: number): number {
  if (!(pnlUsd > 0)) return 0;
  const share = Math.round(pnlUsd * (SOL_PROFIT_SHARE_PCT / 100) * 1e6) / 1e6;
  return share >= MIN_SHARE_USD ? share : 0;
}

export function solProfitShares(state: AppState): { tradeId: string; symbol: string; shareUsd: number }[] {
  return state.trades
    .filter((trade) => trade.action === "close" && !trade.note.includes("Shared $"))
    .map((trade) => ({ tradeId: trade.id, symbol: trade.symbol, shareUsd: profitShareUsd(trade.pnlUsd ?? 0) }))
    .filter((row) => row.shareUsd > 0);
}

function markShared(trade: Trade, shareUsd: number, signature?: string): Trade {
  return {
    ...trade,
    note: `${trade.note} Shared $${shareUsd.toFixed(2)} (${SOL_PROFIT_SHARE_PCT}%) to the profit address${signature ? ` · ${signature}` : ""}.`,
  };
}

export function applySolProfitShares(
  state: AppState,
  shares: { tradeId: string; shareUsd: number; signature?: string }[],
): AppState {
  if (!shares.length) return state;
  const byId = new Map(shares.map((row) => [row.tradeId, row]));
  let cut = 0;
  const trades = state.trades.map((trade) => {
    const row = byId.get(trade.id);
    if (!row || trade.note.includes("Shared $")) return trade;
    cut += row.shareUsd;
    return markShared(trade, row.shareUsd, row.signature);
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

/** Take 10% of each new winning Solana close. Live sends USDC from the trading key. */
export async function takeSolProfitShare(
  state: AppState,
  opts: { live?: boolean; owner?: string | null; solPriceUsd?: number } = {},
): Promise<AppState> {
  const due = solProfitShares(state);
  if (!due.length) return state;
  let next = applySolProfitShares(state, due);
  const owner = opts.owner ?? getActiveWallet("solana");
  if (!opts.live || !owner) return next;
  const sent: { tradeId: string; shareUsd: number; signature?: string }[] = [];
  const failed: string[] = [];
  for (const row of due) {
    try {
      const signature = (await sendSolProfitShare(owner, row.shareUsd, opts.solPriceUsd)) ?? undefined;
      sent.push({ ...row, signature });
    } catch (error) {
      sent.push(row);
      failed.push(error instanceof Error ? error.message : "profit share failed");
    }
  }
  next = applySolProfitShares(state, sent);
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
