import { SOL_MINT } from "@/lib/market/universe";
import { sameMint } from "@/lib/chain";
import type { BotConfig, ChainFill, ChainOrder, Position } from "@/lib/types";

/** Jupiter perp multipliers the desk can send. SOL only. */
export const MULTIPLIERS = [5, 10] as const;
export type Multiplier = (typeof MULTIPLIERS)[number];

/** Smallest SOL 5x or 10x order this desk will post. */
export const PERP_MIN_COLLATERAL_USD = 5;

/**
 * Jupiter rejects a brand-new position under $10.
 * A $5 order is still sent. The perp call raises it to this when the key can pay.
 */
export const JUPITER_MIN_COLLATERAL_USD = 10;

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
  const strong = confidence >= 66 || reason === "breakout";
  if (strong && enabled.includes(10)) return 10;
  if (enabled.includes(5)) return 5;
  if (enabled.includes(10)) return 10;
  return null;
}

/** 5x and 10x are SOL only. Every other name is a spot buy and a spot sell. */
export function multiplierFor(
  multipliers: unknown,
  confidence: number,
  reason: string,
  symbol: string,
  mint: string,
): 1 | Multiplier {
  const sol = symbol === "SOL" || mint === SOL_MINT || sameMint(mint, SOL_MINT);
  if (!sol) return 1;
  return pickMultiplier(normalizeMultipliers(multipliers), confidence, reason) ?? 1;
}

/** Spot ignores 5x/10x. Margin or both with an empty list still uses both. */
export function effectiveMultipliers(mode: BotConfig["solTradeMode"], multipliers: unknown): Multiplier[] {
  if (mode === "spot") return [];
  const enabled = normalizeMultipliers(multipliers);
  return enabled.length ? enabled : [...DEFAULT_MULTIPLIERS];
}

/**
 * SOL perp size after the user's spot / margin / 4-hour choice.
 * A 15-minute SOL setup stays 1x when margin waits for a 4-hour structure.
 */
export function tradeLeverage(args: {
  multipliers: unknown;
  confidence: number;
  reason: string;
  symbol: string;
  mint: string;
  mode?: BotConfig["solTradeMode"];
  marginOnFourHour?: boolean;
  setupFrame?: "15m" | "4h";
}): 1 | Multiplier {
  const mode = args.mode ?? "spot";
  if (mode === "spot") return 1;
  if (args.marginOnFourHour && args.setupFrame !== "4h") return 1;
  return multiplierFor(
    effectiveMultipliers(mode, args.multipliers),
    args.confidence,
    args.reason,
    args.symbol,
    args.mint,
  );
}

/**
 * Older Zebec and CRO tickets were marked at the multiplier after a spot buy.
 * New tickets do not use this. A close of one of those rows still sells the real bag.
 */
export function marginFill(fill: ChainFill, leverage: number, collateralUsd: number): ChainFill {
  const mult = leverage === 10 ? 10 : leverage === 5 ? 5 : 1;
  if (mult === 1) return fill;
  return { ...fill, qty: fill.qty * mult, leverage: mult, collateralUsd };
}

/**
 * Spot tickets stay inside the cash-concentration cap.
 * A 5x or 10x ticket posts collateral from the spendable leg, so that cap cannot
 * turn a key that can post $5 into a spot buy.
 */
export function collateralRoom(cashUsd: number, cashCap: number, leverage: number): number {
  const cash = Math.max(0, cashUsd);
  const cap = Number.isFinite(cashCap) ? Math.max(0, cashCap) : 0;
  if (!(leverage > 1)) return cash * Math.min(0.98, cap);
  if (cash + 1e-9 >= PERP_MIN_COLLATERAL_USD) return cash;
  return cash * 0.98;
}

/** Size a ticket, keeping 5x or 10x whenever the paying leg can post $5. */
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
 * A wallet under $5 falls back to a spot buy. Jupiter may still require $10 to open.
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

/** A wallet signature that still has something to sell or decrease. A practice short has no signature. */
export function signedOnChain(pos: Pick<Position, "signature" | "side" | "leverage">): boolean {
  if (!pos.signature) return false;
  if (pos.side === "short") return (pos.leverage ?? 1) > 1;
  return pos.side === "long";
}

/**
 * Close or scale what the venue actually holds.
 * A SOL 5x or 10x, long or short, decreases the perp by the marked exposure.
 * A spot bag was bought with the collateral only, so the sell is that bag, not the marked exposure.
 */
export function orderForPosition(pos: Position, kind: "close" | "scale", venues?: string[], fraction = 1): ChainOrder {
  const lev = pos.leverage && pos.leverage > 1 ? pos.leverage : 1;
  const perp = lev > 1 && (pos.symbol === "SOL" || pos.mint === SOL_MINT);
  const slice = kind === "scale" ? fraction : 1;
  const bookQty = pos.qty * slice;
  const qty = perp ? bookQty : bookQty / lev;
  return {
    kind,
    side: pos.side,
    mint: pos.mint,
    symbol: pos.symbol,
    notionalUsd: qty * pos.markPrice,
    qty,
    price: pos.markPrice,
    tokenDecimals: pos.tokenDecimals,
    venues,
    leverage: lev > 1 ? lev : undefined,
    collateralUsd: pos.collateralUsd,
    positionPubkey: pos.positionPubkey,
  };
}
