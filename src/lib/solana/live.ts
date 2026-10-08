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
  executeUltraOrder,
  fetchQuote,
  fetchSwapTransaction,
  fetchUltraOrder,
  fromAtomic,
  SOL_FEE_RESERVE,
  toAtomic,
  type JupiterQuote,
  type SwapBuild,
} from "./jupiter";
import { serializeSignedTx, signVersionedTx } from "@/lib/solana/wallet";
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
  mode: "metis" | "ultra";
  requestId: string | null;
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
  if (input.send && !input.sessionArmed) return "Re-confirm LIVE this session before sending swaps";
  if (input.signalSide === "short") return "This desk only buys and sells";
  if (input.killSwitch && input.leg === "buy") return "Kill switch is on";
  if (input.leg === "buy" && input.sol < input.minSolForFees) {
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

export function needsSponsoredClose(solBalance: number): boolean {
  return solBalance < SOL_FEE_RESERVE;
}

export function sellQtyAfterFeeReserve(mint: string, qty: number, solBalance: number | undefined): number {
  if (mint !== SOL_MINT || solBalance === undefined) return qty;
  const free = Math.max(0, solBalance - SOL_FEE_RESERVE);
  return Math.min(qty, free);
}

export async function planLiveSwap(args: {
  owner: string;
  mint: string;
  leg: LiveLeg;
  usdcAmount?: number;
  tokenQty?: number;
  slippageBps: number;
  solBalance?: number;
}): Promise<LivePlan> {
  const mint = args.mint;
  const inputMint = args.leg === "buy" ? USDC_MINT : mint === SOL_MINT ? SOL_MINT : mint;
  const outputMint = args.leg === "buy" ? mint : USDC_MINT;
  const [inDecimals, outDecimals] = await Promise.all([
    args.leg === "buy" ? Promise.resolve(6) : readMintDecimals(inputMint),
    args.leg === "buy" ? readMintDecimals(outputMint) : Promise.resolve(6),
  ]);
  const qty =
    args.leg === "sell" ? sellQtyAfterFeeReserve(mint, args.tokenQty ?? 0, args.solBalance) : args.tokenQty ?? 0;
  if (args.leg === "sell" && mint === SOL_MINT && qty <= 0) {
    throw new Error(
      "Closing this SOL position would drop the wallet under Phantom's 0.005 SOL fee buffer. Leave 0.006 SOL, or close a token position instead.",
    );
  }
  const amount = args.leg === "buy" ? toAtomic(args.usdcAmount ?? 0, 6) : toAtomic(qty, inDecimals);
  const sponsor = args.leg === "sell" && args.solBalance !== undefined && needsSponsoredClose(args.solBalance);
  if (sponsor) {
    const order = await fetchUltraOrder({
      inputMint,
      outputMint,
      amount,
      taker: args.owner,
      slippageBps: args.slippageBps,
    });
    const transaction = decodeSwapTransaction(order.transaction);
    return {
      leg: args.leg,
      mode: "ultra",
      requestId: order.requestId,
      mint,
      inputMint,
      outputMint,
      quote: {
        inputMint,
        outputMint,
        inAmount: order.inAmount,
        outAmount: order.outAmount,
        otherAmountThreshold: order.outAmount,
        slippageBps: args.slippageBps,
        priceImpactPct: null,
        routePlan: [],
        raw: {},
      },
      build: {
        swapTransaction: order.transaction,
        lastValidBlockHeight: null,
        prioritizationFeeLamports: null,
        simulationError: null,
      },
      transaction,
      inUi: fromAtomic(order.inAmount, inDecimals),
      outUi: fromAtomic(order.outAmount, outDecimals),
      inDecimals,
      outDecimals,
    };
  }
  const quote = await fetchQuote({
    inputMint,
    outputMint,
    amount,
    slippageBps: args.slippageBps,
  });
  const build = await fetchSwapTransaction(quote, args.owner, { close: args.leg === "sell" });
  if (build.simulationError) {
    throw new Error(`Jupiter simulation failed: ${build.simulationError}`);
  }
  const transaction = decodeSwapTransaction(build.swapTransaction);
  return {
    leg: args.leg,
    mode: "metis",
    requestId: null,
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
  const signature =
    plan.mode === "ultra" && plan.requestId
      ? await executeUltraOrder(
          serializeSignedTx(await signVersionedTx(provider, plan.transaction)),
          plan.requestId,
        )
      : await signAndSendVersionedTx(provider, plan.transaction);
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
