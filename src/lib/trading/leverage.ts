import { SOL_MINT, WCRO_MINT, ZBCN_MINT } from "@/lib/market/universe";
import { sameMint } from "@/lib/chain";
import type { ChainFill, ChainOrder, Position } from "@/lib/types";

/** Jupiter perp multipliers the desk can send. */
export const MULTIPLIERS = [5, 10] as const;
export type Multiplier = (typeof MULTIPLIERS)[number];

/** Jupiter rejects a new perp below this collateral. */
export const PERP_MIN_COLLATERAL_USD = 10;

/** Left on the trading key for the position account, on top of the network fee. */
export const PERP_RENT_SOL = 0.015;

const DEFAULT_MULTIPLIERS: Multiplier[] = [5, 10];

export function normalizeMultipliers(value: unknown): Multiplier[] {
  if (value == null) return [...DEFAULT_MULTIPLIERS];
  if (!Array.isArray(value)) return [...DEFAULT_MULTIPLIERS];
  const out: Multiplier[] = [];
  for (const item of value) {
    const n = typeof item === "number" ? item : Number(item);
    if ((n === 5 || n === 10) && !out.includes(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

/** 10x on a stronger tape, 5x otherwise. Null when both multipliers are off. */
export function pickMultiplier(enabled: readonly Multiplier[], confidence: number, reason: string): Multiplier | null {
  if (!enabled.length) return null;
  const strong = confidence >= 72 || reason === "breakout";
  if (strong && enabled.includes(10)) return 10;
  if (enabled.includes(5)) return 5;
  if (enabled.includes(10)) return 10;
  return null;
}

/** SOL, Zebec, and CRO take 5x or 10x. Anything else in the book stays spot. */
export function multiplierFor(
  multipliers: unknown,
  confidence: number,
  reason: string,
  symbol: string,
  mint: string,
): 1 | Multiplier {
  const levered =
    symbol === "SOL" ||
    symbol === "ZBCN" ||
    symbol === "CRO" ||
    mint === SOL_MINT ||
    mint === ZBCN_MINT ||
    sameMint(mint, WCRO_MINT);
  if (!levered) return 1;
  return pickMultiplier(normalizeMultipliers(multipliers), confidence, reason) ?? 1;
}

/**
 * A Zebec or CRO multiplier buys the collateral as spot, then the book marks the full exposure.
 * Jupiter perps do not list ZBCN or CRO, so this is how that 5x or 10x is held.
 */
export function marginFill(fill: ChainFill, leverage: number, collateralUsd: number): ChainFill {
  const mult = leverage === 10 ? 10 : leverage === 5 ? 5 : 1;
  if (mult === 1) return fill;
  return { ...fill, qty: fill.qty * mult, leverage: mult, collateralUsd };
}

/**
 * Spot tickets stay inside the cash-concentration cap.
 * A 5x or 10x ticket posts collateral from the spendable leg, so that cap cannot
 * turn a key that can post $10 into a spot buy.
 */
export function collateralRoom(cashUsd: number, cashCap: number, leverage: number): number {
  const cash = Math.max(0, cashUsd);
  const cap = Number.isFinite(cashCap) ? Math.max(0, cashCap) : 0;
  if (!(leverage > 1)) return cash * Math.min(0.98, cap);
  if (cash + 1e-9 >= PERP_MIN_COLLATERAL_USD) return cash;
  return cash * 0.98;
}

/** Size a ticket, keeping 5x or 10x whenever the paying leg can post $10. */
export function leveragedTicket(
  spotNotional: number,
  cashUsd: number,
  cashCap: number,
  wanted: number,
): { leverage: number; collateralUsd: number; spotFallback: boolean } {
  return collateralFor(spotNotional, collateralRoom(cashUsd, cashCap, wanted), wanted);
}

/**
 * Collateral posted for a perp, or the spot notional when leverage is 1.
 * A wallet under the Jupiter $10 floor falls back to a spot buy.
 */
export function collateralFor(
  spotNotional: number,
  room: number,
  leverage: number,
): { leverage: number; collateralUsd: number; spotFallback: boolean } {
  const spend = Math.min(Math.max(spotNotional, 0), Math.max(room, 0));
  if (!(leverage > 1)) return { leverage: 1, collateralUsd: spend, spotFallback: false };
  if (room + 1e-9 < PERP_MIN_COLLATERAL_USD) {
    return { leverage: 1, collateralUsd: spend, spotFallback: true };
  }
  const collateralUsd = Math.min(room, Math.max(spend, PERP_MIN_COLLATERAL_USD));
  return { leverage, collateralUsd, spotFallback: false };
}

export function orderForPosition(pos: Position, kind: "close" | "scale", venues?: string[], fraction = 1): ChainOrder {
  const slice = kind === "scale" ? fraction : 1;
  return {
    kind,
    side: pos.side,
    mint: pos.mint,
    symbol: pos.symbol,
    notionalUsd: pos.qty * slice * pos.markPrice,
    qty: pos.qty * slice,
    price: pos.markPrice,
    tokenDecimals: pos.tokenDecimals,
    venues,
    leverage: pos.leverage && pos.leverage > 1 ? pos.leverage : undefined,
    collateralUsd: pos.collateralUsd,
    positionPubkey: pos.positionPubkey,
  };
}
