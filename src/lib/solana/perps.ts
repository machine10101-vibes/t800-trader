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

export interface PerpIncreasePlan {
  asset: "SOL";
  inputToken: "SOL" | "USDC";
  inputTokenAmount: string;
  side: "long";
  leverage: "5" | "10";
  maxSlippageBps: "100";
  collateralUsd: number;
}

export interface PerpDecreasePlan {
  positionPubkey: string;
  receiveToken: "SOL";
  maxSlippageBps: "100";
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
  const side = "long" as const;
  const maxSlippageBps = "100" as const;
  const cushioned = collateral * COLLATERAL_CUSHION;
  if (order.usdc + 1e-6 >= cushioned) {
    return {
      asset: "SOL",
      inputToken: "USDC",
      inputTokenAmount: baseUnits(cushioned, 6),
      side,
      leverage: String(leverage) as "5" | "10",
      maxSlippageBps,
      collateralUsd: cushioned,
    };
  }
  if (order.usdc + 1e-6 >= PERP_MIN_COLLATERAL_USD && order.usdc + 1e-6 >= collateral) {
    return {
      asset: "SOL",
      inputToken: "USDC",
      inputTokenAmount: baseUnits(order.usdc, 6),
      side,
      leverage: String(leverage) as "5" | "10",
      maxSlippageBps,
      collateralUsd: order.usdc,
    };
  }
  if (!(order.solPriceUsd > 0)) throw new Error("USDC does not cover this margin, and the SOL price is missing.");
  const capSol = order.sol - SOL_FEE_RESERVE - PERP_RENT_SOL;
  const capUsd = capSol * order.solPriceUsd;
  const post = Math.min(cushioned, capUsd);
  if (!(post + 1e-6 >= PERP_MIN_COLLATERAL_USD)) {
    throw new Error(
      `A ${leverage}x position needs at least $${PERP_MIN_COLLATERAL_USD} of collateral. The trading key does not cover that after the fee reserve.`,
    );
  }
  return {
    asset: "SOL",
    inputToken: "SOL",
    inputTokenAmount: baseUnits(post / order.solPriceUsd, 9),
    side,
    leverage: String(leverage) as "5" | "10",
    maxSlippageBps,
    collateralUsd: post,
  };
}

export function planPerpDecrease(order: ChainOrder): PerpDecreasePlan {
  if (!order.positionPubkey) throw new Error("This leveraged ticket has no position account, so it cannot be closed.");
  if (order.kind === "close") {
    return { positionPubkey: order.positionPubkey, receiveToken: "SOL", maxSlippageBps: "100", entirePosition: true };
  }
  if (!(order.notionalUsd > 0)) throw new Error("Nothing to scale out of this multiplier.");
  return {
    positionPubkey: order.positionPubkey,
    receiveToken: "SOL",
    maxSlippageBps: "100",
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

export function fillFromIncrease(quote: IncreaseQuote, positionPubkey: string | null, signature: string): ChainFill {
  const price = perpUsd(quote.averagePriceUsd);
  const collateralUsd = perpUsd(quote.collateralUsdDelta);
  const notional = perpUsd(quote.sizeUsdDelta);
  const qty = price > 0 ? notional / price : 0;
  const leverage = Number(quote.leverage);
  if (!(qty > 0) || !(price > 0)) throw new Error("Jupiter did not return a fill for this multiplier.");
  return {
    signature,
    qty,
    price,
    tokenDecimals: 9,
    leverage: leverage === 10 ? 10 : 5,
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

async function waitForPosition(wallet: string, side: string): Promise<string | null> {
  for (let i = 0; i < 4; i++) {
    const found = await findPosition(wallet, side).catch(() => null);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return null;
}

export async function settlePerp(session: WalletSession, order: ChainOrder): Promise<ChainFill> {
  const signer = tradingKeypair(session.address);
  if (!signer) throw new Error("Arm the bot and approve the wallet signature before a multiplier can be sent.");
  const trader = signer.publicKey.toBase58();
  const balances = await readBalances(trader);
  if (order.kind === "open") {
    const price = balances.solPriceUsd ?? order.price ?? 0;
    const openWith = async (collateralUsd: number | undefined) => {
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
          maxSlippageBps: plan.maxSlippageBps,
          walletAddress: trader,
        },
      );
      return { plan, opened };
    };
    let plan: PerpIncreasePlan;
    let opened: { serializedTxBase64?: string | null; positionPubkey?: string | null; quote?: IncreaseQuote };
    try {
      ({ plan, opened } = await openWith(order.collateralUsd));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const tiny = /collateral size|at least \$10/i.test(message);
      const bumped = (order.collateralUsd ?? PERP_MIN_COLLATERAL_USD) * 1.25;
      if (!tiny || !(bumped > (order.collateralUsd ?? 0))) throw error;
      ({ plan, opened } = await openWith(bumped));
    }
    if (!opened.serializedTxBase64 || !opened.quote) throw new Error("Jupiter did not return a 5x or 10x transaction.");
    const signature = await submit(opened.serializedTxBase64, signer, "increase-position");
    const positionPubkey = opened.positionPubkey || (await waitForPosition(trader, plan.side));
    return fillFromIncrease(opened.quote, positionPubkey, signature);
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
