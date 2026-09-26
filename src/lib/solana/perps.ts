import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { SOL_MINT } from "@/lib/market/universe";
import type { ChainFill, ChainOrder } from "@/lib/types";
import { PERP_MIN_COLLATERAL_USD, PERP_RENT_SOL } from "@/lib/trading/leverage";
import { SOL_FEE_RESERVE } from "@/lib/trading/risk";
import { tradingKeypair } from "./authorize";
import { baseUnits } from "./swap";
import { readBalances, type WalletSession } from "./wallet";

const PERPS_URL = "https://perps-api.jup.ag/v1";
const MIN_SOL = 0.005;
/** Extra margin so Jupiter's own mark still clears the $10 floor. */
const COLLATERAL_CUSHION = 1.25;
/** Compute-unit price so a 5x or 10x transaction is not left at the back of the queue. */
const PRIORITY_FEE_MICRO_LAMPORTS = "250000" as const;
/** Tighter rent haircut used only when the normal reserve would drop a post under $10. */
const TIGHT_RENT_SOL = 0.008;

export interface PerpIncreasePlan {
  asset: "SOL";
  inputToken: "SOL" | "USDC";
  inputTokenAmount: string;
  side: "long";
  leverage: "5" | "10";
  sizeUsdDelta: string;
  maxSlippageBps: "100";
  priorityFeeMicroLamports: "250000";
  collateralUsd: number;
}

export interface PerpDecreasePlan {
  positionPubkey: string;
  receiveToken: "SOL";
  maxSlippageBps: "100";
  priorityFeeMicroLamports: "250000";
  entirePosition: boolean;
  sizeUsdDelta?: string;
}

/** Jupiter USD fields are 1e6 integers. A decimal string is already human dollars. */
export function perpUsd(value: string | undefined): number {
  if (!value) return 0;
  if (value.includes(".")) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n / 1e6;
}

export function planPerpIncrease(
  order: ChainOrder & { usdc: number; sol: number; solPriceUsd: number },
): PerpIncreasePlan {
  if (order.side === "short") throw new Error("Shorts are not sent on-chain.");
  if (order.kind !== "open") throw new Error("Only a new ticket opens a multiplier.");
  const leverage = order.leverage === 10 ? 10 : order.leverage === 5 ? 5 : 0;
  if (!leverage) throw new Error("Multiplier must be 5x or 10x.");
  if (order.symbol !== "SOL" && order.mint !== SOL_MINT) {
    throw new Error(`${order.symbol} has no 5x or 10x market. Zebec stays a spot swap.`);
  }
  const collateral = order.collateralUsd ?? order.notionalUsd / leverage;
  if (!(collateral >= PERP_MIN_COLLATERAL_USD)) {
    throw new Error(`A ${leverage}x position needs at least $${PERP_MIN_COLLATERAL_USD} of collateral.`);
  }
  if (order.sol < MIN_SOL) throw new Error("Need at least 0.005 SOL in the wallet to pay the network fee.");
  const cushioned = collateral * COLLATERAL_CUSHION;
  const usdc = Math.max(0, order.usdc);
  if (usdc + 1e-6 >= cushioned || (usdc + 1e-6 >= PERP_MIN_COLLATERAL_USD && usdc + 1e-6 >= collateral)) {
    const post = usdc + 1e-6 >= cushioned ? cushioned : usdc;
    return increasePlan("USDC", post, 6, leverage, post);
  }
  const solPost = solCollateralUsd(order.sol, order.solPriceUsd, cushioned);
  if (solPost + 1e-6 >= PERP_MIN_COLLATERAL_USD && order.solPriceUsd > 0) {
    return increasePlan("SOL", solPost / order.solPriceUsd, 9, leverage, solPost);
  }
  if (usdc + 1e-6 >= PERP_MIN_COLLATERAL_USD) {
    return increasePlan("USDC", usdc, 6, leverage, usdc);
  }
  if (!(order.solPriceUsd > 0)) throw new Error("USDC does not cover this margin, and the SOL price is missing.");
  throw new Error(
    `A ${leverage}x position needs at least $${PERP_MIN_COLLATERAL_USD} of collateral. The trading key does not cover that after the fee reserve.`,
  );
}

/** SOL that can be posted. Rent is kept when it still clears $10; otherwise a tighter reserve, then the fee-only balance. */
function solCollateralUsd(sol: number, price: number, cushioned: number): number {
  if (!(price > 0)) return 0;
  const afterFee = Math.max(0, sol - SOL_FEE_RESERVE) * price;
  const afterRent = Math.max(0, sol - SOL_FEE_RESERVE - PERP_RENT_SOL) * price;
  const afterTight = Math.max(0, sol - SOL_FEE_RESERVE - TIGHT_RENT_SOL) * price;
  let capUsd = afterRent;
  if (!(capUsd + 1e-6 >= PERP_MIN_COLLATERAL_USD) && afterTight + 1e-6 >= PERP_MIN_COLLATERAL_USD) capUsd = afterTight;
  else if (!(capUsd + 1e-6 >= PERP_MIN_COLLATERAL_USD) && afterFee + 1e-6 >= PERP_MIN_COLLATERAL_USD) capUsd = afterFee;
  return Math.min(cushioned, capUsd);
}

function increasePlan(
  inputToken: "SOL" | "USDC",
  amountUi: number,
  decimals: number,
  leverage: 5 | 10,
  collateralUsd: number,
): PerpIncreasePlan {
  return {
    asset: "SOL",
    inputToken,
    inputTokenAmount: baseUnits(amountUi, decimals),
    side: "long",
    leverage: String(leverage) as "5" | "10",
    sizeUsdDelta: baseUnits(collateralUsd * leverage, 6),
    maxSlippageBps: "100",
    priorityFeeMicroLamports: PRIORITY_FEE_MICRO_LAMPORTS,
    collateralUsd,
  };
}

export function planPerpDecrease(order: ChainOrder): PerpDecreasePlan {
  if (!order.positionPubkey) throw new Error("This leveraged ticket has no position account, so it cannot be closed.");
  if (order.kind === "close") {
    return {
      positionPubkey: order.positionPubkey,
      receiveToken: "SOL",
      maxSlippageBps: "100",
      priorityFeeMicroLamports: PRIORITY_FEE_MICRO_LAMPORTS,
      entirePosition: true,
    };
  }
  if (!(order.notionalUsd > 0)) throw new Error("Nothing to scale out of this multiplier.");
  return {
    positionPubkey: order.positionPubkey,
    receiveToken: "SOL",
    maxSlippageBps: "100",
    priorityFeeMicroLamports: PRIORITY_FEE_MICRO_LAMPORTS,
    entirePosition: false,
    sizeUsdDelta: baseUnits(order.notionalUsd, 6),
  };
}

interface IncreaseQuote {
  averagePriceUsd?: string;
  collateralUsdDelta?: string;
  sizeUsdDelta?: string;
  leverage?: string;
}

function multiplierBand(value: number): 5 | 10 | 1 | 0 {
  if (!(value > 0) || !Number.isFinite(value)) return 0;
  if (value >= 7.5 && value <= 12.5) return 10;
  if (value >= 3.5 && value <= 6.5) return 5;
  if (value >= 0.5 && value <= 1.5) return 1;
  return 0;
}

function formatMultiplier(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * The quote must be a real 5x or 10x before the transaction is signed.
 * A missing leverage and a missing size accept the requested multiplier.
 * An explicit 1x quote is refused. A 10x request that Jupiter priced at 5x is booked at 5x.
 */
export function quotedMultiplier(quote: IncreaseQuote, requested: 5 | 10): 5 | 10 {
  const statedRaw = quote.leverage != null && String(quote.leverage).trim() !== "" ? Number(quote.leverage) : NaN;
  const collateral = perpUsd(quote.collateralUsdDelta);
  const size = perpUsd(quote.sizeUsdDelta);
  const implied = collateral > 0 && size > 0 ? size / collateral : NaN;
  const stated = multiplierBand(statedRaw);
  const ratio = multiplierBand(implied);
  if (stated === 1 || ratio === 1) {
    const shown = stated === 1 && Number.isFinite(statedRaw) ? statedRaw : implied;
    throw new Error(
      `Jupiter quoted this long at ${formatMultiplier(shown)}x, so the ${requested}x ticket was not sent.`,
    );
  }
  if (ratio === 5 || ratio === 10) return ratio;
  if (stated === 5 || stated === 10) return stated;
  const statedMissing = !Number.isFinite(statedRaw) || !(statedRaw > 0);
  const sizeMissing = !Number.isFinite(implied);
  if (statedMissing && sizeMissing) return requested;
  const shown = Number.isFinite(implied) ? implied : statedRaw;
  throw new Error(
    `Jupiter quoted this long at ${formatMultiplier(shown)}x, so the ${requested}x ticket was not sent.`,
  );
}

export function fillFromIncrease(
  quote: IncreaseQuote,
  positionPubkey: string | null,
  signature: string,
  booked?: 5 | 10,
): ChainFill {
  const price = perpUsd(quote.averagePriceUsd);
  const collateralUsd = perpUsd(quote.collateralUsdDelta);
  const notional = perpUsd(quote.sizeUsdDelta);
  const qty = price > 0 ? notional / price : 0;
  if (!(qty > 0) || !(price > 0)) throw new Error("Jupiter did not return a fill for this multiplier.");
  const leverage = booked ?? quotedMultiplier(quote, 5);
  return {
    signature,
    qty,
    price,
    tokenDecimals: 9,
    leverage,
    collateralUsd: collateralUsd > 0 ? collateralUsd : undefined,
    positionPubkey: positionPubkey ?? undefined,
  };
}

interface PerpsError {
  message?: string;
  error?: string;
  code?: string;
}

async function perps<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${PERPS_URL}${path}`, {
    method,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-perps-api-version": "v2",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as T & PerpsError;
  if (!res.ok) throw new Error(json.message || json.error || `${res.status} from Jupiter perps`);
  return json;
}

function decodeTx(b64: string): VersionedTransaction {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return VersionedTransaction.deserialize(bytes);
}

function encodeTx(tx: VersionedTransaction): string {
  const bytes = tx.serialize();
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

async function submit(b64: string, key: Keypair, action: "increase-position" | "decrease-position"): Promise<string> {
  const tx = decodeTx(b64);
  tx.sign([key]);
  const result = await perps<{ txid?: string }>("/transaction/execute", "POST", {
    action,
    serializedTxBase64: encodeTx(tx),
  });
  if (!result.txid) throw new Error("Jupiter did not return a signature for this multiplier.");
  return result.txid;
}

interface ListedPosition {
  asset?: string;
  side?: string;
  positionPubkey?: string;
}

async function findPosition(wallet: string, side: string): Promise<string | null> {
  const listed = await perps<{ dataList?: ListedPosition[] }>(
    `/positions?walletAddress=${encodeURIComponent(wallet)}&includeClosedPositions=false`,
    "GET",
  );
  const hit = (listed.dataList ?? []).find((row) => row.asset === "SOL" && row.side === side && row.positionPubkey);
  return hit?.positionPubkey ?? null;
}

export async function settlePerp(session: WalletSession, order: ChainOrder): Promise<ChainFill> {
  const signer = tradingKeypair(session.address);
  if (!signer) throw new Error("Arm the bot and approve the wallet signature before a multiplier can be sent.");
  const trader = signer.publicKey.toBase58();
  const balances = await readBalances(trader);
  if (order.kind === "open") {
    const price = balances.solPriceUsd ?? order.price ?? 0;
    const openWith = async (collateralUsd: number | undefined, includeSize: boolean) => {
      const plan = planPerpIncrease({
        ...order,
        collateralUsd: collateralUsd ?? order.collateralUsd,
        usdc: balances.usdc,
        sol: balances.sol,
        solPriceUsd: price,
      });
      const opened = await perps<{ serializedTxBase64?: string | null; positionPubkey?: string | null; quote?: IncreaseQuote }>(
        "/positions/increase",
        "POST",
        {
          asset: plan.asset,
          inputToken: plan.inputToken,
          inputTokenAmount: plan.inputTokenAmount,
          side: plan.side,
          leverage: plan.leverage,
          ...(includeSize ? { sizeUsdDelta: plan.sizeUsdDelta } : {}),
          maxSlippageBps: plan.maxSlippageBps,
          priorityFeeMicroLamports: plan.priorityFeeMicroLamports,
          walletAddress: trader,
        },
      );
      return { plan, opened };
    };
    const attempts: Array<[number | undefined, boolean]> = [
      [order.collateralUsd, true],
      [order.collateralUsd, false],
    ];
    let plan: PerpIncreasePlan | undefined;
    let opened: { serializedTxBase64?: string | null; positionPubkey?: string | null; quote?: IncreaseQuote } | undefined;
    let booked: 5 | 10 | undefined;
    let lastError: unknown;
    let bumped = false;
    for (const [collateralUsd, includeSize] of attempts) {
      try {
        const next = await openWith(collateralUsd, includeSize);
        if (!next.opened.serializedTxBase64 || !next.opened.quote) {
          lastError = new Error("Jupiter did not return a 5x or 10x transaction.");
          continue;
        }
        const requested = next.plan.leverage === "10" ? 10 : 5;
        booked = quotedMultiplier(next.opened.quote, requested);
        plan = next.plan;
        opened = next.opened;
        break;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : "";
        const tiny = /collateral size|at least \$10/i.test(message);
        const larger = (order.collateralUsd ?? PERP_MIN_COLLATERAL_USD) * 1.25;
        if (tiny && !bumped && larger > (order.collateralUsd ?? 0)) {
          bumped = true;
          attempts.push([larger, true], [larger, false]);
        }
      }
    }
    if (!plan || !opened?.serializedTxBase64 || !opened.quote || !booked) {
      throw lastError instanceof Error ? lastError : new Error("Jupiter did not return a 5x or 10x transaction.");
    }
    const signature = await submit(opened.serializedTxBase64, signer, "increase-position");
    const positionPubkey = opened.positionPubkey || (await findPosition(trader, plan.side).catch(() => null));
    return fillFromIncrease(opened.quote, positionPubkey, signature, booked);
  }

  let pubkey = order.positionPubkey;
  if (!pubkey) pubkey = (await findPosition(trader, order.side)) ?? undefined;
  if (!pubkey) throw new Error("ALREADY_FLAT: no open multiplier on the trading key");
  const plan = planPerpDecrease({ ...order, positionPubkey: pubkey });
  let closed: { serializedTxBase64?: string | null };
  try {
    closed = await perps<{ serializedTxBase64?: string | null }>("/positions/decrease", "POST", plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : "close failed";
    const live = await findPosition(trader, order.side).catch(() => "unknown");
    if (live === null) throw new Error(`ALREADY_FLAT: ${message}`);
    throw error;
  }
  if (!closed.serializedTxBase64) throw new Error("Jupiter did not return a close for this multiplier.");
  const signature = await submit(closed.serializedTxBase64, signer, "decrease-position");
  return {
    signature,
    qty: order.qty,
    price: order.price,
    tokenDecimals: order.tokenDecimals ?? 9,
    leverage: order.leverage,
    collateralUsd: order.collateralUsd,
    positionPubkey: pubkey,
  };
}
