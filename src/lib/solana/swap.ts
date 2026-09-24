import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { dexesForVenues } from "@/lib/market/venues";
import { SOL_MINT, USDC_MINT } from "@/lib/market/universe";
import type { ChainExecutor, ChainFill, ChainOrder } from "@/lib/types";
import { SOL_FEE_RESERVE } from "@/lib/trading/risk";
import { tradingKeypair } from "./authorize";
import { broadcastTransaction, mintDecimals, readBalances, type WalletSession } from "./wallet";

export const SLIPPAGE_BPS = 80;
const FEE_SOL = SOL_FEE_RESERVE;
const MIN_SOL = 0.005;
const QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";

export interface SpotPlan {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
  dexes: string[] | null;
}

export function baseUnits(amount: number, decimals: number): string {
  if (!(amount > 0) || decimals < 0 || decimals > 12) throw new Error("Ticket size is not a real token amount");
  const text = amount.toFixed(decimals);
  const [whole, frac = ""] = text.split(".");
  const digits = `${frac}${"0".repeat(decimals)}`.slice(0, decimals);
  const units = `${whole}${digits}`.replace(/^0+/, "") || "0";
  if (units === "0") throw new Error("Ticket is smaller than one base unit");
  return units;
}

export function planSpotOrder(
  order: ChainOrder & { usdc: number; sol: number; solPriceUsd: number },
): SpotPlan {
  if (order.side === "short") {
    throw new Error("Wallet swaps are spot buys and sells. Shorts are not sent to the wallet.");
  }
  if (order.sol < MIN_SOL) {
    throw new Error("Need at least 0.005 SOL in the wallet to pay the network fee.");
  }
  const dexes = dexesForVenues(order.venues);
  const slippageBps = SLIPPAGE_BPS;
  if (order.kind === "open") {
    if (!(order.notionalUsd > 0)) throw new Error("Ticket notional is empty");
    if (order.mint === SOL_MINT && order.usdc + 1e-6 < order.notionalUsd) {
      throw new Error("Buying SOL needs USDC in the wallet. This ticket is larger than the USDC balance.");
    }
    if (order.usdc + 1e-6 >= order.notionalUsd) {
      return {
        inputMint: USDC_MINT,
        outputMint: order.mint,
        amount: baseUnits(order.notionalUsd, 6),
        slippageBps,
        dexes,
      };
    }
    if (!(order.solPriceUsd > 0)) {
      throw new Error("USDC does not cover this ticket, and the SOL price is missing.");
    }
    const solNeed = order.notionalUsd / order.solPriceUsd;
    if (order.sol - FEE_SOL < solNeed) {
      throw new Error(
        `Wallet has ${order.usdc.toFixed(2)} USDC and ${order.sol.toFixed(3)} SOL. This ticket needs about $${order.notionalUsd.toFixed(2)}.`,
      );
    }
    return {
      inputMint: SOL_MINT,
      outputMint: order.mint,
      amount: baseUnits(solNeed, 9),
      slippageBps,
      dexes,
    };
  }
  if (order.tokenDecimals === undefined) throw new Error("Token decimals are missing, so the sell amount is unknown");
  if (!(order.qty > 0)) throw new Error("Nothing to sell");
  return {
    inputMint: order.mint,
    outputMint: USDC_MINT,
    amount: baseUnits(order.qty, order.tokenDecimals),
    slippageBps,
    dexes,
  };
}

interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct?: string;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(json.error || json.message || `${res.status} from Jupiter`);
  return json;
}

function decodeTx(b64: string): VersionedTransaction {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return VersionedTransaction.deserialize(bytes);
}

function uiAmount(units: string, decimals: number): number {
  const n = Number(units);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Jupiter returned an empty fill");
  return n / 10 ** decimals;
}

function signLocally(tx: VersionedTransaction, key: Keypair): Uint8Array {
  tx.sign([key]);
  return tx.serialize();
}

export async function settleSpot(session: WalletSession, order: ChainOrder): Promise<ChainFill> {
  const signer = tradingKeypair(session.address);
  if (!signer) throw new Error("Arm the bot and approve the wallet signature before a swap can be sent.");
  const trader = signer.publicKey.toBase58();
  const balances = await readBalances(trader);
  const tokenDecimals =
    order.tokenDecimals ?? (order.kind === "open" ? undefined : await mintDecimals(order.mint));
  const plan = planSpotOrder({
    ...order,
    tokenDecimals,
    usdc: balances.usdc,
    sol: balances.sol,
    solPriceUsd: balances.solPriceUsd ?? 0,
  });
  const params = new URLSearchParams({
    inputMint: plan.inputMint,
    outputMint: plan.outputMint,
    amount: plan.amount,
    slippageBps: String(plan.slippageBps),
  });
  if (plan.dexes?.length) params.set("dexes", plan.dexes.join(","));
  const quoteRes = await fetch(`${QUOTE_URL}?${params.toString()}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const quote = (await quoteRes.json()) as JupiterQuote & { error?: string };
  if (!quoteRes.ok || !quote.outAmount) {
    throw new Error(quote.error || "Jupiter has no route for this ticket on the venues you left on");
  }
  const impact = Number(quote.priceImpactPct);
  if (Number.isFinite(impact) && impact > 5) {
    throw new Error(`Price impact is ${impact.toFixed(2)}%. The ticket was not sent.`);
  }
  const built = await postJson<{ swapTransaction?: string; simulationError?: unknown; error?: string }>(SWAP_URL, {
    quoteResponse: quote,
    userPublicKey: trader,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: "auto",
  });
  if (!built.swapTransaction) throw new Error(built.error || "Jupiter did not return a transaction");
  const simulated = built.simulationError as { error?: string } | string | null | undefined;
  const simulatedError = typeof simulated === "string" ? simulated : simulated?.error;
  if (simulatedError) throw new Error(`Jupiter could not simulate this swap (${simulatedError})`);
  const tx = decodeTx(built.swapTransaction);
  const signature = await broadcastTransaction(signLocally(tx, signer));
  if (!signature) throw new Error("Wallet did not return a signature");

  const outDecimals = plan.outputMint === USDC_MINT ? 6 : plan.outputMint === SOL_MINT ? 9 : await mintDecimals(plan.outputMint);
  const inDecimals = plan.inputMint === USDC_MINT ? 6 : plan.inputMint === SOL_MINT ? 9 : (tokenDecimals ?? (await mintDecimals(plan.inputMint)));
  const outQty = uiAmount(quote.outAmount, outDecimals);
  const inQty = uiAmount(quote.inAmount, inDecimals);
  const solPrice = balances.solPriceUsd ?? order.price;
  let price = order.price;
  if (plan.inputMint === USDC_MINT && outQty > 0) price = inQty / outQty;
  else if (plan.outputMint === USDC_MINT && inQty > 0) price = outQty / inQty;
  else if (plan.inputMint === SOL_MINT && outQty > 0) price = (inQty * solPrice) / outQty;
  const qty = plan.outputMint === USDC_MINT ? inQty : outQty;
  const decimals = plan.outputMint === USDC_MINT ? (tokenDecimals ?? inDecimals) : outDecimals;
  return { signature, qty, price, tokenDecimals: decimals };
}

export function executorFor(session: WalletSession): ChainExecutor {
  return (order) => settleSpot(session, order);
}
