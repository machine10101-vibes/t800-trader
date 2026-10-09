import { encodeFunctionData, type Hex } from "viem";
import { minOut } from "./arm";
import { CRO_TRADE_FEE_BPS, CRO_TRADE_ROUTER, SLIPPAGE_BPS, USDC, VVS_ROUTER, WCRO } from "./constants";
import { cronosClient } from "./wallet";

export const WOLFSWAP_API = "https://api-partners.wolfswap.app";
/**
 * WolfSwap publishes this key for builders. A production key overrides it with
 * NEXT_PUBLIC_WOLFSWAP_API_KEY. Quotes do not add a partner fee on top.
 */
export const WOLFSWAP_TEST_KEY = "wcoDe1kG6tvJMBVdn_uYxq6DJdW9Om2Ef_izmJE3ckE";

const quoteAbi = [
  {
    name: "getAmountsOut",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path", type: "address[]" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

const croAbi = [
  {
    name: "swapExactTokensForTokens",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "dexRouter", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

export type CronosVenue = "wolfswap" | "vvs" | "crotrade";

export interface CronosRoute {
  venue: CronosVenue;
  side: "buy" | "sell";
  token: `0x${string}`;
  amountIn: bigint;
  amountOut: bigint;
  path: readonly `0x${string}`[];
  wolfQuoteId?: string;
}

export function wolfswapKey(): string {
  const raw = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_WOLFSWAP_API_KEY?.trim() : "";
  return raw || WOLFSWAP_TEST_KEY;
}

export function afterFee(amount: bigint, feeBps: number): bigint {
  if (amount <= 0n) return 0n;
  const bps = Math.max(0, Math.min(10_000, Math.round(feeBps)));
  return (amount * BigInt(10_000 - bps)) / 10_000n;
}

export function isCronosNativeToken(token: string): boolean {
  return token.toLowerCase() === WCRO.toLowerCase();
}

export function cronosQuoteDecimals(quote: "usdc" | "cro" = "usdc"): number {
  return quote === "cro" ? 18 : 6;
}

/**
 * USDC to the token, or the token back to USDC. CRO is WCRO. Memes hop through WCRO.
 * When the quote is CRO, a meme is WCRO in and WCRO out. CRO itself has no path.
 */
export function cronosSwapPath(
  token: `0x${string}`,
  side: "buy" | "sell",
  quote: "usdc" | "cro" = "usdc",
): `0x${string}`[] {
  const cro = isCronosNativeToken(token);
  if (quote === "cro") {
    if (cro) throw new Error("This desk spends CRO, so it cannot buy or sell CRO.");
    return side === "buy" ? [WCRO, token] : [token, WCRO];
  }
  if (side === "buy") return cro ? [USDC, WCRO] : [USDC, WCRO, token];
  return cro ? [WCRO, USDC] : [token, WCRO, USDC];
}

/**
 * WolfSwap's amount out already includes its route.
 * VVS is the raw router quote. cro.trade is that same quote after the published 0.9% fee.
 * A tie stays on WolfSwap, then VVS, then cro.trade.
 */
export function decideRoute(
  wolfOut: bigint | null,
  vvsOut: bigint | null,
  enabled: Partial<Record<CronosVenue, boolean>> = {},
): { venue: CronosVenue; amountOut: bigint } | null {
  const allowed = (venue: CronosVenue) => enabled[venue] !== false;
  const wolf = allowed("wolfswap") && wolfOut && wolfOut > 0n ? wolfOut : null;
  const vvs = allowed("vvs") && vvsOut && vvsOut > 0n ? vvsOut : null;
  const cro = allowed("crotrade") && vvsOut && vvsOut > 0n ? afterFee(vvsOut, CRO_TRADE_FEE_BPS) : null;
  const picks: { venue: CronosVenue; amountOut: bigint }[] = [];
  if (wolf) picks.push({ venue: "wolfswap", amountOut: wolf });
  if (vvs) picks.push({ venue: "vvs", amountOut: vvs });
  if (cro && cro > 0n) picks.push({ venue: "crotrade", amountOut: cro });
  if (!picks.length) return null;
  const rank: Record<CronosVenue, number> = { wolfswap: 2, vvs: 1, crotrade: 0 };
  picks.sort((a, b) => {
    if (a.amountOut === b.amountOut) return rank[b.venue] - rank[a.venue];
    return a.amountOut > b.amountOut ? -1 : 1;
  });
  return picks[0]!;
}

export function buildCroTradeCall(input: {
  amountIn: bigint;
  amountOutMin: bigint;
  path: readonly `0x${string}`[];
  deadline: bigint;
}): { to: typeof CRO_TRADE_ROUTER; data: Hex; value: bigint } {
  const path = [...input.path] as `0x${string}`[];
  const tokenIn = path[0];
  const tokenOut = path[path.length - 1];
  if (!tokenIn || !tokenOut) throw new Error("cro.trade needs a token path");
  return {
    to: CRO_TRADE_ROUTER,
    value: 0n,
    data: encodeFunctionData({
      abi: croAbi,
      functionName: "swapExactTokensForTokens",
      args: [tokenIn, tokenOut, input.amountIn, input.amountOutMin, path, VVS_ROUTER, input.deadline],
    }),
  };
}

async function quoteWolfswap(
  src: `0x${string}`,
  dst: `0x${string}`,
  amount: bigint,
): Promise<{ amountOut: bigint; quoteId: string } | null> {
  const res = await fetch(`${WOLFSWAP_API}/v2/quote`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${wolfswapKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      networkId: 25,
      srcToken: src,
      dstToken: dst,
      amount: amount.toString(),
      exactIn: true,
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as unknown;
  const row = Array.isArray(json) ? (json[0] as { amountOutTotal?: string; quoteId?: string } | undefined) : null;
  if (!row?.amountOutTotal || !row.quoteId) return null;
  let amountOut = 0n;
  try {
    amountOut = BigInt(row.amountOutTotal);
  } catch {
    return null;
  }
  if (amountOut <= 0n) return null;
  return { amountOut, quoteId: String(row.quoteId) };
}

async function quoteVvs(amountIn: bigint, path: readonly `0x${string}`[]): Promise<bigint | null> {
  if (path.length < 2) return null;
  try {
    const amounts = await cronosClient().readContract({
      address: VVS_ROUTER,
      abi: quoteAbi,
      functionName: "getAmountsOut",
      args: [amountIn, [...path]],
    });
    const out = amounts[amounts.length - 1] ?? 0n;
    return out > 0n ? out : null;
  } catch {
    return null;
  }
}

export async function quoteCronos(input: {
  token: `0x${string}`;
  amountIn: bigint;
  side: "buy" | "sell";
  quote?: "usdc" | "cro";
}): Promise<CronosRoute> {
  const path = cronosSwapPath(input.token, input.side, input.quote === "cro" ? "cro" : "usdc");
  const src = path[0];
  const dst = path[path.length - 1];
  if (!src || !dst) throw new Error("This ticket has no Cronos path");
  const [wolf, vvs] = await Promise.all([
    quoteWolfswap(src, dst, input.amountIn).catch(() => null),
    quoteVvs(input.amountIn, path),
  ]);
  const picked = decideRoute(wolf?.amountOut ?? null, vvs);
  if (!picked) throw new Error("WolfSwap, VVS, and cro.trade have no route for this ticket");
  return {
    venue: picked.venue,
    side: input.side,
    token: input.token,
    amountIn: input.amountIn,
    amountOut: picked.amountOut,
    path,
    wolfQuoteId: picked.venue === "wolfswap" ? wolf?.quoteId : undefined,
  };
}

export async function buildWolfswapCall(
  quoteId: string,
  recipient: `0x${string}`,
  slippageBps = SLIPPAGE_BPS,
): Promise<{ to: `0x${string}`; data: Hex }> {
  const res = await fetch(`${WOLFSWAP_API}/v2/execute`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${wolfswapKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      quoteId,
      to: recipient,
      slippage: slippageBps,
    }),
  });
  if (!res.ok) throw new Error("WolfSwap could not build this swap");
  const json = (await res.json()) as { address?: string; calldata?: string };
  if (!json.address?.startsWith("0x") || !json.calldata?.startsWith("0x")) {
    throw new Error("WolfSwap returned an empty swap");
  }
  return { to: json.address as `0x${string}`, data: json.calldata as Hex };
}

export function croTradeMinOut(amountOut: bigint, slippageBps = SLIPPAGE_BPS): bigint {
  return minOut(amountOut, slippageBps);
}
