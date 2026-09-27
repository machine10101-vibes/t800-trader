import { encodeFunctionData, type Hex } from "viem";
import { USDC, VVS_ROUTER, WCRO } from "./constants";

const routerAbi = [
  {
    name: "swapExactETHForTokens",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    name: "swapExactTokensForETH",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    name: "swapExactTokensForTokens",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

export type VvsMethod = "swapExactETHForTokens" | "swapExactTokensForETH" | "swapExactTokensForTokens";

export interface VvsSwap {
  method: VvsMethod;
  /** UI amount of the input token. ETH methods spend native CRO. */
  amountIn: number;
  path: readonly [`0x${string}`, `0x${string}`];
  /** Token the router must be allowed to pull. Absent when the input is native CRO. */
  approve?: `0x${string}`;
}

/** A CRO buy spends USDC on the VVS router. Holding CRO is not a substitute swap. */
export function planVvsBuy(spendUsd: number, usdc: number, cro: number): VvsSwap {
  if (!(spendUsd > 0)) throw new Error("Ticket notional is empty");
  if (usdc + 1e-6 >= spendUsd) {
    return {
      method: "swapExactTokensForETH",
      amountIn: spendUsd,
      path: [USDC, WCRO],
      approve: USDC,
    };
  }
  throw new Error(
    `Buying CRO on VVS needs USDC in the trading key. This key has ${usdc.toFixed(2)} USDC and ${cro.toFixed(3)} CRO.`,
  );
}

export type CronosOpen = { kind: "swap"; swap: VvsSwap };

/** A CRO buy spends USDC. Holding CRO is not a buy — a red or flat 15m sells that bag on VVS. */
export function planCronosOpen(spendUsd: number, usdc: number, cro: number): CronosOpen {
  return { kind: "swap", swap: planVvsBuy(spendUsd, usdc, cro) };
}

/** A CRO sell pays the VVS router. Wrapped CRO uses the token path. Native CRO is the payable path. */
export function planVvsSell(cro: number, wcro: number): VvsSwap {
  if (wcro > 0 && wcro >= cro) {
    return {
      method: "swapExactTokensForTokens",
      amountIn: wcro,
      path: [WCRO, USDC],
      approve: WCRO,
    };
  }
  if (!(cro > 0)) throw new Error("ALREADY_FLAT: trading key does not hold this token");
  return {
    method: "swapExactETHForTokens",
    amountIn: cro,
    path: [WCRO, USDC],
  };
}

export function buildVvsCall(input: {
  method: VvsMethod;
  amountIn: bigint;
  amountOutMin: bigint;
  path: readonly [`0x${string}`, `0x${string}`];
  recipient: `0x${string}`;
  deadline: bigint;
}): { to: typeof VVS_ROUTER; data: Hex; value: bigint } {
  const path = [input.path[0], input.path[1]] as [`0x${string}`, `0x${string}`];
  if (input.method === "swapExactETHForTokens") {
    return {
      to: VVS_ROUTER,
      value: input.amountIn,
      data: encodeFunctionData({
        abi: routerAbi,
        functionName: "swapExactETHForTokens",
        args: [input.amountOutMin, path, input.recipient, input.deadline],
      }),
    };
  }
  return {
    to: VVS_ROUTER,
    value: 0n,
    data: encodeFunctionData({
      abi: routerAbi,
      functionName: input.method,
      args: [input.amountIn, input.amountOutMin, path, input.recipient, input.deadline],
    }),
  };
}
