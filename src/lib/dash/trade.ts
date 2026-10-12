import { rememberBudget } from "@/lib/trading/budgetCache";
import type { TradingSnap } from "@/lib/solana/authorize";
import type { ChainExecutor, ChainFill, ChainOrder } from "@/lib/types";
import { DASH_TOKEN, tokenDecimals } from "./constants";
import { connectNearMobile, signNearTransfer } from "./nearMobile";
import { nearDexQuoteBody, requestNearDexQuote, spendContract, swapPair, unitsToAmount, type DashSpend } from "./quote";
import { connectDashPay, dashSession, readDashBalances, type DashSession } from "./wallet";

export type { DashSession };

const savedNear = "t800-trader-dash-near";
const savedPay = "t800-trader-dash-pay";

function storageGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The session still lives in memory.
  }
}

function storageRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Disconnect still clears the in-memory session.
  }
}

export function savedDashAccounts(): { nearAccountId: string | null; dashAccount: string | null } {
  return { nearAccountId: storageGet(savedNear), dashAccount: storageGet(savedPay) };
}

export function rememberDashAccounts(nearAccountId: string | null, dashAccount: string | null): void {
  if (nearAccountId) storageSet(savedNear, nearAccountId);
  if (dashAccount) storageSet(savedPay, dashAccount);
}

export function disconnectDash(): void {
  storageRemove(savedNear);
  storageRemove(savedPay);
}

export async function assembleDashSession(
  nearAccountId: string | null,
  dashAccount: string | null,
  priceHint?: number | null,
): Promise<DashSession> {
  rememberDashAccounts(nearAccountId, dashAccount);
  const balances = await readDashBalances(nearAccountId, priceHint);
  const session = dashSession({ nearAccountId, dashAccount, ...balances });
  if (!session.address) throw new Error("Connect DashPay or NEAR Mobile to open the Dash desk.");
  return session;
}

export async function connectDash(trusted = false, side?: "dashpay" | "near"): Promise<DashSession> {
  const saved = savedDashAccounts();
  let nearAccountId = saved.nearAccountId;
  let dashAccount = saved.dashAccount;
  if (!trusted && side === "dashpay") dashAccount = await connectDashPay();
  if (!trusted && side === "near") nearAccountId = await connectNearMobile();
  if (trusted && !nearAccountId && !dashAccount) throw new Error("Wallet is not connected.");
  return assembleDashSession(nearAccountId, dashAccount);
}

export async function refreshDash(session: DashSession): Promise<DashSession> {
  return assembleDashSession(session.nearAccountId, session.dashAccount, session.solPriceUsd);
}

function spendOf(order: ChainOrder): DashSpend {
  return order.dashQuote === "dash" ? "dash" : "usdt";
}

function amountIn(order: ChainOrder, tokenIn: string): number {
  if (tokenIn === order.mint) return order.qty;
  if (!(order.price > 0)) throw new Error("This ticket has no price, so the swap was not sent.");
  return order.notionalUsd / (tokenIn === DASH_TOKEN ? order.price : 1);
}

export function dashExecutor(session: DashSession): ChainExecutor {
  return async (order: ChainOrder): Promise<ChainFill> => {
    const account = session.nearAccountId;
    if (!account) throw new Error("Connect NEAR Mobile before a real swap.");
    const spend = spendOf(order);
    const pair = swapPair({ kind: order.kind, mint: order.mint, spend });
    if (pair.tokenIn === pair.tokenOut) throw new Error("That coin is the one this desk spends, so it was not bought.");
    const body = nearDexQuoteBody({
      tokenIn: pair.tokenIn,
      tokenOut: pair.tokenOut,
      amountIn: amountIn(order, pair.tokenIn),
      accountId: account,
      slippageBps: order.slippageBps ?? 80,
    });
    const quoted = await requestNearDexQuote(body);
    const deposit = quoted.quote?.depositAddress ?? "";
    const signature = await signNearTransfer({
      signerId: account,
      token: pair.tokenIn,
      receiverId: deposit,
      amount: body.amount,
      memo: quoted.quote?.depositMemo,
    });
    const outDecimals = tokenDecimals(pair.tokenOut);
    const outRaw = quoted.quote?.amountOut ?? "";
    const qty = order.kind === "open" ? unitsToAmount(outRaw, outDecimals) || order.qty : order.qty;
    return {
      signature,
      qty: qty > 0 ? qty : order.qty,
      price: order.price,
      tokenDecimals: tokenDecimals(order.mint),
      dashQuote: spend,
    };
  };
}

export async function dashBudget(session: DashSession | null | undefined) {
  if (!session?.nearAccountId) return null;
  const balances = await readDashBalances(session.nearAccountId, session.solPriceUsd);
  return rememberBudget("dash", session.nearAccountId, {
    usdc: balances.usdc,
    sol: balances.sol,
    solPriceUsd: balances.solPriceUsd ?? 0,
  });
}

export async function dashSnapshot(owner: string): Promise<TradingSnap | null> {
  const held = await readDashBalances(owner).catch(() => null);
  if (!held) return null;
  rememberBudget("dash", owner, { usdc: held.usdc, sol: held.sol, solPriceUsd: held.solPriceUsd ?? 0 });
  return { address: owner, sol: held.sol, usdc: held.usdc, equityUsd: held.equityUsd };
}

export async function authorizeDash(session: DashSession): Promise<{
  signature: string;
  botAddress: string;
  reused: boolean;
  equityUsd: number;
  depositedUsd: number;
}> {
  if (!session.dashAccount) throw new Error("Connect DashPay before arming real money.");
  if (!session.nearAccountId) throw new Error("Connect NEAR Mobile before arming real money.");
  const balances = await readDashBalances(session.nearAccountId, session.solPriceUsd);
  return {
    signature: session.nearAccountId,
    botAddress: session.nearAccountId,
    reused: true,
    equityUsd: balances.equityUsd,
    depositedUsd: 0,
  };
}

export function dashSpendContract(spend: DashSpend): string {
  return spendContract(spend);
}
