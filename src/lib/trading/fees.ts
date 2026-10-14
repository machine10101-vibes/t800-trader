import { sameMint } from "@/lib/chain";
import { SOL_MINT } from "@/lib/market/universe";

/** Paper fills move the price by this much on top of the venue fee. */
export const PAPER_SLIP_BPS = 8;

/**
 * Venue cost a paper fill pays on top of the slip, so PAPER results read like LIVE.
 * Jupiter perps charge about 6 bps of size per side. SOL/USDC routes are a few bps.
 * Smaller Solana names route through 0.25% pools.
 * Cronos quotes already include the pool. WolfSwap's own fee estimate is 0.5% of output,
 * so a practice fill pays that. A direct VVS fill uses the pool quote. cro.trade's 0.9%
 * is only used when that quote is the one sent.
 */
export const CRONOS_VENUE_FEE_BPS = 50;

export function venueFeeBps(mint: string, symbol: string, leverage = 1): number {
  if (mint.startsWith("0x") || mint.startsWith("0X")) return CRONOS_VENUE_FEE_BPS;
  if (symbol === "SOL" || sameMint(mint, SOL_MINT)) return leverage > 1 ? 7 : 3;
  return 20;
}

/** Ten percent of a gain. The same cut Solana, Cronos, and Dash send to the profit address. Dust under a cent is not charged. */
export const USAGE_FEE_PCT = 10;
const MIN_USAGE_FEE_USD = 0.01;

/** Pool fee on one fill, in dollars. This is the swap fee, not the usage cut. */
export function swapFeeUsd(mint: string, symbol: string, notionalUsd: number, leverage = 1): number {
  if (!(notionalUsd > 0)) return 0;
  const bps = venueFeeBps(mint, symbol, leverage);
  return Math.round(notionalUsd * (bps / 10_000) * 1e6) / 1e6;
}

/** Usage fee on a close. A loss or a scratch pays nothing. */
export function usageFeeUsd(pnlUsd: number | null | undefined): number {
  if (!(pnlUsd != null && pnlUsd > 0)) return 0;
  const share = Math.round(pnlUsd * (USAGE_FEE_PCT / 100) * 1e6) / 1e6;
  return share >= MIN_USAGE_FEE_USD ? share : 0;
}

/**
 * How far the mark has to move past the filled entry before a sale may count as a win.
 * The entry already includes the open fee. Closing still costs the slip plus the close fee.
 * The profit left after that must be greater than the open fee and the close fee together.
 * Cronos uses the same hurdle, priced at the WolfSwap fee estimate.
 */
export function feeHurdlePct(mint: string, symbol: string, leverage = 1): number {
  const fee = venueFeeBps(mint, symbol, leverage) / 100;
  if (!(fee > 0)) return 0;
  const closeCost = (PAPER_SLIP_BPS + venueFeeBps(mint, symbol, leverage)) / 100;
  return closeCost + fee + fee + 0.01;
}

/** A configured target that would not clear both fees is raised to the hurdle. */
export function targetAboveFees(mint: string, symbol: string, leverage: number, targetPct: number): number {
  const hurdle = feeHurdlePct(mint, symbol, leverage);
  if (!(hurdle > 0)) return targetPct;
  return Math.max(targetPct, hurdle);
}
