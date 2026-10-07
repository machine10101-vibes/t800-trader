import { sameMint } from "@/lib/chain";
import { SOL_MINT } from "@/lib/market/universe";

/** Paper fills move the price by this much on top of the venue fee. */
export const PAPER_SLIP_BPS = 8;

/**
 * Venue cost a paper fill pays on top of the slip, so PAPER results read like LIVE.
 * Jupiter perps charge about 6 bps of size per side. SOL/USDC routes are a few bps.
 * Smaller Solana names route through 0.25% pools. Cronos rows are left as they were.
 */
export function venueFeeBps(mint: string, symbol: string, leverage = 1): number {
  if (!mint || mint.startsWith("0x")) return 0;
  if (symbol === "SOL" || sameMint(mint, SOL_MINT)) return leverage > 1 ? 7 : 3;
  return 20;
}

/**
 * How far the mark has to move past the filled entry before a sale may count as a win.
 * The entry already includes the open fee. Closing still costs the slip plus the close fee.
 * The profit left after that must be greater than the open fee and the close fee together.
 * Cronos pays no venue fee here, so the hurdle stays 0 and those exits are unchanged.
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
