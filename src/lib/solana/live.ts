import { SOL_MINT, USDC_MINT } from "@/lib/market/universe";
import type { ExecutionMode } from "@/lib/types";
import {
  confirmSignature,
  readMintDecimals,
  readTokenUiAmount,
  signAndSendVersionedTx,
  type InjectedProvider,
} from "@/lib/solana/wallet";
import {
  decodeSwapTransaction,
  fetchQuote,
  fetchSwapTransaction,
  fromAtomic,
  toAtomic,
  type JupiterQuote,
  type SwapBuild,
} from "./jupiter";
import type { VersionedTransaction } from "@solana/web3.js";

export type LiveLeg = "buy" | "sell";

export interface LiveRuntime {
  address: string;
  sol: number;
  usdc: number;
  provider: InjectedProvider;
  send: boolean;
}

export interface LivePreflightInput {
  executionMode: ExecutionMode | string;
  sessionArmed: boolean;
  killSwitch: boolean;
  send: boolean;
  leg: LiveLeg;
  signalSide: "long" | "short";
  notionalUsd: number;
  tokenQty: number;
  usdc: number;
  sol: number;
  maxLiveNotionalUsd: number;
  minSolForFees: number;
}

export interface LivePlan {
  leg: LiveLeg;
  mint: string;
  inputMint: string;
  outputMint: string;
  quote: JupiterQuote;
  build: SwapBuild;
  transaction: VersionedTransaction;
  inUi: number;
  outUi: number;
  inDecimals: number;
  outDecimals: number;
}

export interface LiveFill {
  signature: string;
  mint: string;
  leg: LiveLeg;
  inUi: number;
  outUi: number;
  priceUsd: number;
}

export function preflightLiveSwap(input: LivePreflightInput): string | null {
  if (input.executionMode !== "live") return "Not in LIVE mode";
  if (input.killSwitch) return "Kill switch is on";
  if (input.send && !input.sessionArmed) return "Re-confirm LIVE this session before sending swaps";
  if (input.signalSide === "short") return "Spot Solana cannot short without perps — shorts stay paper-only";
  if (input.sol < input.minSolForFees) {
    return `Need at least ${input.minSolForFees} SOL for fees (wallet has ${input.sol.toFixed(4)})`;
  }
  if (input.notionalUsd > input.maxLiveNotionalUsd) {
    return `Notional $${input.notionalUsd.toFixed(2)} exceeds live max $${input.maxLiveNotionalUsd.toFixed(2)}`;
  }
  if (input.leg === "buy") {
    if (input.notionalUsd < 5) return "Live buy notional is below $5";
    if (input.usdc + 1e-6 < input.notionalUsd) {
      return `Need ${input.notionalUsd.toFixed(2)} USDC (wallet has ${input.usdc.toFixed(2)})`;
    }
  }
  if (input.leg === "sell") {
    if (input.tokenQty <= 0) return "No token balance to sell";
  }
  return null;
}

export async function planLiveSwap(args: {
  owner: string;
  mint: string;
  leg: LiveLeg;
  usdcAmount?: number;
  tokenQty?: number;
  slippageBps: number;
}): Promise<LivePlan> {
  const mint = args.mint;
  const inputMint = args.leg === "buy" ? USDC_MINT : mint === SOL_MINT ? SOL_MINT : mint;
  const outputMint = args.leg === "buy" ? mint : USDC_MINT;
  const [inDecimals, outDecimals] = await Promise.all([
    args.leg === "buy" ? Promise.resolve(6) : readMintDecimals(inputMint),
    args.leg === "buy" ? readMintDecimals(outputMint) : Promise.resolve(6),
  ]);
  const amount =
    args.leg === "buy" ? toAtomic(args.usdcAmount ?? 0, 6) : toAtomic(args.tokenQty ?? 0, inDecimals);
  const quote = await fetchQuote({
    inputMint,
    outputMint,
    amount,
    slippageBps: args.slippageBps,
  });
  const build = await fetchSwapTransaction(quote, args.owner);
  if (build.simulationError) {
    throw new Error(`Jupiter simulation failed: ${build.simulationError}`);
  }
  const transaction = decodeSwapTransaction(build.swapTransaction);
  return {
    leg: args.leg,
    mint,
    inputMint,
    outputMint,
    quote,
    build,
    transaction,
    inUi: fromAtomic(quote.inAmount, inDecimals),
    outUi: fromAtomic(quote.outAmount, outDecimals),
    inDecimals,
    outDecimals,
  };
}

export async function executeLivePlan(
  provider: InjectedProvider,
  plan: LivePlan,
  owner: string,
): Promise<LiveFill> {
  const before = plan.leg === "buy" ? await readTokenUiAmount(owner, plan.mint) : await readTokenUiAmount(owner, USDC_MINT);
  const signature = await signAndSendVersionedTx(provider, plan.transaction);
  await confirmSignature(signature);
  const after = plan.leg === "buy" ? await readTokenUiAmount(owner, plan.mint) : await readTokenUiAmount(owner, USDC_MINT);
  const outUi = after > before ? after - before : plan.outUi;
  const inUi = plan.inUi;
  const priceUsd = plan.leg === "buy" ? (outUi > 0 ? inUi / outUi : 0) : outUi / Math.max(inUi, 1e-12);
  return {
    signature,
    mint: plan.mint,
    leg: plan.leg,
    inUi,
    outUi,
    priceUsd,
  };
}
