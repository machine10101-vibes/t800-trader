import { VersionedTransaction } from "@solana/web3.js";
import { clamp, fetchJson } from "@/lib/utils";

export const DEFAULT_JUPITER_API = "https://lite-api.jup.ag/swap/v1";
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

export function swapRequestBody(quote: JupiterQuote, userPublicKey: string): Record<string, unknown> {
  return {
    quoteResponse: quote.raw,
    userPublicKey,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: {
      priorityLevelWithMaxLamports: {
        maxLamports: 400_000,
        priorityLevel: "high",
      },
    },
  };
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

export async function fetchSwapTransaction(quote: JupiterQuote, userPublicKey: string): Promise<SwapBuild> {
  const res = await fetch(swapUrl(), {
    method: "POST",
    cache: "no-store",
    headers: { ...jupiterHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(swapRequestBody(quote, userPublicKey)),
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
