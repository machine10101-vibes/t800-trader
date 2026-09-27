import { SOL_MINT, USDC_MINT } from "@/lib/market/universe";
import type { RestingQuote } from "@/lib/types";
import { SOL_FEE_RESERVE } from "@/lib/trading/risk";
import { baseUnits } from "@/lib/solana/swap";

/** Jupiter trigger orders reject anything under $5. */
export const LIMIT_MIN_USD = 5;
/** Bid this far under the mid so the order rests instead of crossing the ask. */
export const INSIDE_BPS = 8;

export interface MakerPlan {
  inputMint: string;
  outputMint: string;
  makingAmount: string;
  takingAmount: string;
  limitPrice: number;
  notionalUsd: number;
  outputDecimals: number;
}

export interface MakerFill {
  signature: string;
  qty: number;
  price: number;
  tokenDecimals: number;
}

export interface MakerPlace {
  mint: string;
  symbol: string;
  mid: number;
  notionalUsd: number;
}

/** Lookup result for one resting order. */
export type MakerLook = MakerFill | "open" | "gone";

export interface MakerDesk {
  place(order: MakerPlace): Promise<{ orderKey: string; signature: string; limitPrice: number; outputDecimals: number }>;
  cancel(orderKey: string): Promise<void>;
  lookup(quote: RestingQuote): Promise<MakerLook>;
}

export function makerBid(mid: number): number {
  if (!(mid > 0)) throw new Error("Missing price for the limit bid");
  return mid * (1 - INSIDE_BPS / 10_000);
}

/** Leave a resting bid alone until the mid has moved by more than the inside step. */
export function shouldReplace(limitPrice: number, mid: number): boolean {
  if (!(limitPrice > 0) || !(mid > 0)) return true;
  const next = makerBid(mid);
  return Math.abs(next - limitPrice) / limitPrice > INSIDE_BPS / 10_000;
}

/**
 * Spend USDC when it covers the bid, otherwise SOL.
 * takingAmount is the token size at the inside bid, so the order does not cross.
 */
export function planMakerBuy(args: {
  mint: string;
  mid: number;
  notionalUsd: number;
  usdc: number;
  sol: number;
  solPriceUsd: number;
  outputDecimals: number;
}): MakerPlan {
  if (!(args.notionalUsd >= LIMIT_MIN_USD)) {
    throw new Error(`A resting limit needs at least $${LIMIT_MIN_USD}.`);
  }
  const limitPrice = makerBid(args.mid);
  const outputQty = args.notionalUsd / limitPrice;
  const takingAmount = baseUnits(outputQty, args.outputDecimals);
  if (args.mint === SOL_MINT) {
    if (args.usdc + 1e-6 < args.notionalUsd) {
      throw new Error("A SOL limit bid needs USDC in the trading key.");
    }
    return {
      inputMint: USDC_MINT,
      outputMint: SOL_MINT,
      makingAmount: baseUnits(args.notionalUsd, 6),
      takingAmount,
      limitPrice,
      notionalUsd: args.notionalUsd,
      outputDecimals: args.outputDecimals,
    };
  }
  if (args.usdc + 1e-6 >= args.notionalUsd) {
    return {
      inputMint: USDC_MINT,
      outputMint: args.mint,
      makingAmount: baseUnits(args.notionalUsd, 6),
      takingAmount,
      limitPrice,
      notionalUsd: args.notionalUsd,
      outputDecimals: args.outputDecimals,
    };
  }
  if (!(args.solPriceUsd > 0)) throw new Error("USDC does not cover this bid, and the SOL price is missing.");
  const solNeed = args.notionalUsd / args.solPriceUsd;
  if (args.sol - SOL_FEE_RESERVE < solNeed) {
    throw new Error(
      `This limit bid needs about $${args.notionalUsd.toFixed(2)}. The trading key does not cover that after the fee reserve.`,
    );
  }
  return {
    inputMint: SOL_MINT,
    outputMint: args.mint,
    makingAmount: baseUnits(solNeed, 9),
    takingAmount,
    limitPrice,
    notionalUsd: args.notionalUsd,
    outputDecimals: args.outputDecimals,
  };
}

interface TriggerTrade {
  action?: string;
  txId?: string;
  rawOutputAmount?: string;
}

interface TriggerOrder {
  status?: string;
  rawTakingAmount?: string;
  closeTx?: string;
  trades?: TriggerTrade[];
}

/** A position is booked only from a fill transaction, not from the order that rested the bid. */
export function readTriggerOrder(order: TriggerOrder, limitPrice: number, outputDecimals: number): MakerLook {
  const status = (order.status ?? "").toLowerCase();
  const trade = (order.trades ?? []).find((row) => (row.action ?? "").toLowerCase() === "fill" && row.txId?.trim());
  const signature = (trade?.txId || (status === "completed" ? order.closeTx : "") || "").trim();
  const raw = trade?.rawOutputAmount || (status === "completed" ? order.rawTakingAmount : "") || "";
  const qty = Number(raw) / 10 ** outputDecimals;
  if (signature && qty > 0 && (trade || status === "completed")) {
    return { signature, qty, price: limitPrice, tokenDecimals: outputDecimals };
  }
  if (status === "cancelled" || status === "canceled" || status === "expired") return "gone";
  return "open";
}
