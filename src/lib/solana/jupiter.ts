import { VersionedTransaction } from "@solana/web3.js";
import { clamp, fetchJson } from "@/lib/utils";

export const DEFAULT_JUPITER_API = "https://lite-api.jup.ag/swap/v1";
export const DEFAULT_ULTRA_API = "https://lite-api.jup.ag/ultra/v1";
/** Phantom refuses to sign a user-paid tx below this native balance. */
export const PHANTOM_SOL_BUFFER = 0.005;
/** Leave a hair above Phantom's buffer so a close does not drain the fee payer. */
export const SOL_FEE_RESERVE = 0.006;
export const USDC_DECIMALS = 6;
export const SOL_DECIMALS = 9;

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string | number | null;
  routePlan: unknown[];
  raw: Record<string, unknown>;
}

export interface SwapBuild {
  swapTransaction: string;
  lastValidBlockHeight: number | null;
  prioritizationFeeLamports: number | null;
  simulationError: string | null;
}

export function jupiterBaseUrl(): string {
  const raw = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_JUPITER_API?.trim() : "";
  return (raw || DEFAULT_JUPITER_API).replace(/\/$/, "");
}

export function ultraBaseUrl(): string {
  const raw = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_JUPITER_ULTRA_API?.trim() : "";
  return (raw || DEFAULT_ULTRA_API).replace(/\/$/, "");
}

export function jupiterHeaders(): Record<string, string> {
  const key = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_JUPITER_API_KEY?.trim() : "";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (key) headers["x-api-key"] = key;
  return headers;
}

export function clampSlippageBps(bps: number): number {
  return clamp(Math.round(bps), 1, 2_000);
}

export function toAtomic(amount: number, decimals: number): string {
  if (!Number.isFinite(amount) || amount <= 0 || decimals < 0) return "0";
  const scaled = amount * 10 ** decimals;
  if (!Number.isFinite(scaled) || scaled < 1) return "0";
  return BigInt(Math.floor(scaled)).toString();
}

export function fromAtomic(amount: string | number, decimals: number): number {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || decimals < 0) return 0;
  return n / 10 ** decimals;
}

export function quoteUrl(args: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
}): string {
  const q = new URLSearchParams({
    inputMint: args.inputMint,
    outputMint: args.outputMint,
    amount: args.amount,
    slippageBps: String(clampSlippageBps(args.slippageBps)),
    restrictIntermediateTokens: "true",
  });
  return `${jupiterBaseUrl()}/quote?${q.toString()}`;
}

export function swapUrl(): string {
  return `${jupiterBaseUrl()}/swap`;
}

export function swapRequestBody(
  quote: JupiterQuote,
  userPublicKey: string,
  opts?: { close?: boolean },
): Record<string, unknown> {
  return {
    quoteResponse: quote.raw,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: {
        maxLamports: opts?.close ? 15_000 : 100_000,
        priorityLevel: opts?.close ? "medium" : "high",
      },
    },
  };
}

export interface UltraOrder {
  requestId: string;
  transaction: string;
  gasless: boolean;
  inAmount: string;
  outAmount: string;
  inputMint: string;
  outputMint: string;
  errorCode: number | null;
  errorMessage: string | null;
}

export function ultraOrderUrl(args: {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker: string;
  slippageBps: number;
}): string {
  const q = new URLSearchParams({
    inputMint: args.inputMint,
    outputMint: args.outputMint,
    amount: args.amount,
    taker: args.taker,
    slippageBps: String(clampSlippageBps(args.slippageBps)),
  });
  return `${ultraBaseUrl()}/order?${q.toString()}`;
}

export function explainUltraCloseError(order: Pick<UltraOrder, "errorCode" | "errorMessage">): string {
  const msg = order.errorMessage || "Jupiter could not build this close";
  if (order.errorCode === 3 || /gasless|minimum/i.test(msg)) {
    return "This close is too small for Jupiter to pay the network fee (about $10). Add at least 0.006 SOL, then close again.";
  }
  if (order.errorCode === 2 || /0\.005|network fee|not enough sol|insufficient sol/i.test(msg)) {
    return "Phantom wants 0.005 SOL to pay fees, and Jupiter could not sponsor this close. Add 0.006 SOL and try again.";
  }
  return msg;
}

export function parseUltraOrder(json: Record<string, unknown>): UltraOrder {
  const order: UltraOrder = {
    requestId: String(json.requestId ?? ""),
    transaction: typeof json.transaction === "string" ? json.transaction : "",
    gasless: Boolean(json.gasless),
    inAmount: String(json.inAmount ?? ""),
    outAmount: String(json.outAmount ?? ""),
    inputMint: String(json.inputMint ?? ""),
    outputMint: String(json.outputMint ?? ""),
    errorCode: typeof json.errorCode === "number" ? json.errorCode : null,
    errorMessage: json.errorMessage ? String(json.errorMessage) : json.error ? String(json.error) : null,
  };
  if (!order.transaction) throw new Error(explainUltraCloseError(order));
  if (!order.requestId) throw new Error("Jupiter close order missing request id");
  return order;
}

export function parseQuote(json: Record<string, unknown>): JupiterQuote {
  if (json.error) throw new Error(String(json.error));
  const inputMint = String(json.inputMint ?? "");
  const outputMint = String(json.outputMint ?? "");
  const inAmount = String(json.inAmount ?? "");
  const outAmount = String(json.outAmount ?? "");
  if (!inputMint || !outputMint || !inAmount || !outAmount) {
    throw new Error("Jupiter quote missing mint or amount");
  }
  if (!Array.isArray(json.routePlan) || json.routePlan.length === 0) {
    throw new Error("Jupiter quote has no route");
  }
  return {
    inputMint,
    outputMint,
    inAmount,
    outAmount,
    otherAmountThreshold: String(json.otherAmountThreshold ?? outAmount),
    slippageBps: Number(json.slippageBps ?? 0),
    priceImpactPct: (json.priceImpactPct as string | number | null) ?? null,
    routePlan: json.routePlan,
    raw: json,
  };
}

export function decodeSwapTransaction(swapTransaction: string): VersionedTransaction {
  if (!swapTransaction) throw new Error("Jupiter swap response missing transaction");
  const binary = typeof atob === "function" ? atob(swapTransaction) : Buffer.from(swapTransaction, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return VersionedTransaction.deserialize(bytes);
}

export async function fetchQuote(args: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
}): Promise<JupiterQuote> {
  if (args.amount === "0") throw new Error("Swap amount is zero");
  const json = await fetchJson<Record<string, unknown>>(quoteUrl(args), {
    timeoutMs: 12_000,
    retries: 2,
    headers: jupiterHeaders(),
  });
  return parseQuote(json);
}

export async function fetchSwapTransaction(
  quote: JupiterQuote,
  userPublicKey: string,
  opts?: { close?: boolean },
): Promise<SwapBuild> {
  const res = await fetch(swapUrl(), {
    method: "POST",
    cache: "no-store",
    headers: { ...jupiterHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(swapRequestBody(quote, userPublicKey, opts)),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || json.error) {
    throw new Error(String(json.error || `Jupiter swap build failed (${res.status})`));
  }
  const swapTransaction = String(json.swapTransaction ?? "");
  if (!swapTransaction) throw new Error("Jupiter swap build returned an empty transaction");
  return {
    swapTransaction,
    lastValidBlockHeight: typeof json.lastValidBlockHeight === "number" ? json.lastValidBlockHeight : null,
    prioritizationFeeLamports: typeof json.prioritizationFeeLamports === "number" ? json.prioritizationFeeLamports : null,
    simulationError: json.simulationError ? String(json.simulationError) : null,
  };
}

export async function fetchUltraOrder(args: {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker: string;
  slippageBps: number;
}): Promise<UltraOrder> {
  if (args.amount === "0") throw new Error("Swap amount is zero");
  const json = await fetchJson<Record<string, unknown>>(ultraOrderUrl(args), {
    timeoutMs: 12_000,
    retries: 2,
    headers: jupiterHeaders(),
  });
  return parseUltraOrder(json);
}

export async function executeUltraOrder(signedTransaction: string, requestId: string): Promise<string> {
  const res = await fetch(`${ultraBaseUrl()}/execute`, {
    method: "POST",
    cache: "no-store",
    headers: { ...jupiterHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ signedTransaction, requestId }),
  });
  const json = (await res.json()) as { status?: string; signature?: string; error?: string; code?: number };
  if (!res.ok || json.status === "Failed" || json.error) {
    const sig = json.signature ? ` Signature ${json.signature}` : "";
    throw new Error(`${json.error || `Jupiter execute failed (${res.status})`}${sig}`);
  }
  if (!json.signature) throw new Error("Jupiter execute did not return a signature");
  return json.signature;
}
