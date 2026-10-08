import type { ChainId } from "@/lib/chain";

export type CashSymbol = "USDC" | "SOL" | "CRO";

export interface CashLeg {
  symbol: CashSymbol;
  amount: number;
  usd: number;
}

export function nativeCashSymbol(chain: ChainId): "SOL" | "CRO" {
  return chain === "cronos" ? "CRO" : "SOL";
}

/** Always USDC plus the desk native, so a $0.005 CRO dust still lists both tokens. */
export function cashLegs(input: {
  chain: ChainId;
  usdc: number;
  native: number;
  nativePriceUsd?: number | null;
}): CashLeg[] {
  const usdc = Math.max(0, Number.isFinite(input.usdc) ? input.usdc : 0);
  const native = Math.max(0, Number.isFinite(input.native) ? input.native : 0);
  const price = input.nativePriceUsd && input.nativePriceUsd > 0 ? input.nativePriceUsd : 0;
  const symbol = nativeCashSymbol(input.chain);
  return [
    { symbol: "USDC", amount: usdc, usd: usdc },
    { symbol, amount: native, usd: native * price },
  ];
}

export function formatCashUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function formatCashAmount(symbol: CashSymbol, amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return symbol === "USDC" ? "$0.00" : `0 ${symbol}`;
  if (symbol === "USDC") return formatCashUsd(amount);
  if (amount >= 1000) return `${amount.toFixed(1)} ${symbol}`;
  if (amount >= 1) return `${amount.toFixed(3)} ${symbol}`;
  if (amount >= 0.001) return `${amount.toFixed(4)} ${symbol}`;
  return `${amount.toFixed(6)} ${symbol}`;
}

export function cashLegLine(leg: CashLeg): string {
  if (leg.symbol === "USDC") return formatCashUsd(leg.amount);
  const qty = formatCashAmount(leg.symbol, leg.amount);
  if (leg.usd <= 0) return qty;
  return `${qty} · ${formatCashUsd(leg.usd)}`;
}

/** Trading key first, then the connected wallet, then paper cash as USDC. */
export function deskCashLegs(input: {
  chain: ChainId;
  live: boolean;
  paperCashUsd?: number;
  nativePriceUsd?: number | null;
  trading?: { usdc: number; sol: number } | null;
  wallet?: { usdc: number; sol: number; wcro?: number } | null;
  preferWallet?: boolean;
}): CashLeg[] {
  const price = input.nativePriceUsd;
  if (input.trading) {
    return cashLegs({ chain: input.chain, usdc: input.trading.usdc, native: input.trading.sol, nativePriceUsd: price });
  }
  if (input.wallet && (input.preferWallet || input.live || (input.paperCashUsd ?? 0) <= 0)) {
    const native = input.chain === "cronos" ? Math.max(0, input.wallet.sol) + Math.max(0, input.wallet.wcro ?? 0) : input.wallet.sol;
    return cashLegs({ chain: input.chain, usdc: input.wallet.usdc, native, nativePriceUsd: price });
  }
  return cashLegs({ chain: input.chain, usdc: input.paperCashUsd ?? 0, native: 0, nativePriceUsd: price });
}
