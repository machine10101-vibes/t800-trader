import { DASH_TOKEN, NEAR_DEX_QUOTE, NEAR_USDT, intentAsset, tokenDecimals } from "./constants";

export type DashSpend = "usdt" | "dash";

export interface NearDexQuoteRequest {
  dry: boolean;
  swapType: "EXACT_INPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN";
  destinationAsset: string;
  amount: string;
  recipient: string;
  recipientType: "DESTINATION_CHAIN";
  refundTo: string;
  refundType: "ORIGIN_CHAIN";
  deadline: string;
}

export interface NearDexQuote {
  quote?: {
    amountIn?: string;
    amountOut?: string;
    amountOutFormatted?: string;
    depositAddress?: string;
    depositMemo?: string | null;
  };
  correlationId?: string;
}

/** Whole coins to the token's smallest unit, without floating the integer. */
export function smallestUnits(amount: number, decimals: number): string {
  if (!(amount > 0) || !Number.isFinite(amount) || decimals < 0) return "0";
  const places = Math.min(18, Math.max(0, Math.floor(decimals)));
  const printed = amount.toFixed(places);
  const [whole, frac = ""] = printed.split(".");
  const digits = `${whole}${frac.padEnd(places, "0").slice(0, places)}`.replace(/^0+(?=\d)/, "");
  return digits || "0";
}

export function unitsToAmount(raw: string, decimals: number): number {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return 0;
  const places = Math.min(18, Math.max(0, Math.floor(decimals)));
  if (digits.length <= places) return Number(digits) / 10 ** places;
  const whole = digits.slice(0, digits.length - places);
  const frac = digits.slice(digits.length - places);
  return Number(`${whole}.${frac}`);
}

export function spendContract(spend: DashSpend): string {
  return spend === "dash" ? DASH_TOKEN : NEAR_USDT;
}

/** A buy spends the quote coin. A sell returns that same coin. */
export function swapPair(input: {
  kind: "open" | "close" | "scale";
  mint: string;
  spend: DashSpend;
}): { tokenIn: string; tokenOut: string } {
  const quote = spendContract(input.spend);
  if (input.kind === "open") return { tokenIn: quote, tokenOut: input.mint };
  return { tokenIn: input.mint, tokenOut: quote };
}

export function nearDexQuoteBody(input: {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  accountId: string;
  slippageBps: number;
  now?: number;
}): NearDexQuoteRequest {
  const decimals = tokenDecimals(input.tokenIn);
  const deadline = new Date((input.now ?? Date.now()) + 3 * 60_000).toISOString();
  return {
    dry: false,
    swapType: "EXACT_INPUT",
    slippageTolerance: Math.max(1, Math.round(input.slippageBps)),
    originAsset: intentAsset(input.tokenIn),
    depositType: "ORIGIN_CHAIN",
    destinationAsset: intentAsset(input.tokenOut),
    amount: smallestUnits(input.amountIn, decimals),
    recipient: input.accountId,
    recipientType: "DESTINATION_CHAIN",
    refundTo: input.accountId,
    refundType: "ORIGIN_CHAIN",
    deadline,
  };
}

export async function requestNearDexQuote(body: NearDexQuoteRequest): Promise<NearDexQuote> {
  const res = await fetch(NEAR_DEX_QUOTE, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as NearDexQuote & { message?: string } | null;
  if (!res.ok) {
    const message = json && typeof json.message === "string" ? json.message : `NEAR DEX quote failed (${res.status})`;
    throw new Error(message);
  }
  if (!json?.quote?.depositAddress) throw new Error("NEAR DEX did not return a deposit address.");
  return json;
}
