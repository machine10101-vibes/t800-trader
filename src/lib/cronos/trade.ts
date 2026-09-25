import type { ArmAuth, TradingSnap } from "@/lib/solana/authorize";
import { planProfitWithdrawal, tradingKeyCoversSpend } from "@/lib/solana/authorize";
import { marginFill } from "@/lib/trading/leverage";
import { sellQty } from "@/lib/solana/swap";
import type { WalletBudget } from "@/lib/trading/risk";
import type { ChainExecutor, ChainFill, ChainOrder } from "@/lib/types";
import { encodeFunctionData, erc20Abi, formatUnits, parseUnits, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { cronos } from "viem/chains";
import { minOut, planCronosArm } from "./arm";
import { BOT_MIN_CRO, GAS_CRO, USDC, VVS_ROUTER } from "./constants";
import { buildVvsCall, planCronosOpen, planVvsSell, type VvsSwap } from "./vvs";
import { cronosClient, readCronosBalances, readWcroBalance, type CronosSession, type EthereumProvider } from "./wallet";

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

function signerStorageKey(owner: string): string {
  return `t800-trader-signer:cronos:${owner.toLowerCase()}`;
}

export function cronosTradingAccount(owner: string): PrivateKeyAccount | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(signerStorageKey(owner));
  if (!raw || !/^0x[0-9a-fA-F]{64}$/.test(raw)) return null;
  return privateKeyToAccount(raw as Hex);
}

export function loadOrCreateCronosKey(owner: string): PrivateKeyAccount {
  const existing = cronosTradingAccount(owner);
  if (existing) return existing;
  if (typeof window === "undefined") throw new Error("Arm the bot from the browser so the wallet can sign.");
  const created = generatePrivateKey();
  window.localStorage.setItem(signerStorageKey(owner), created);
  return privateKeyToAccount(created);
}

function cronosError(error: unknown): Error {
  const message = error instanceof Error ? error.message : "Cronos request failed";
  if (/403|forbidden|access denied/i.test(message)) {
    return new Error("Cronos refused this browser. The bot is still armed — try disarm again.");
  }
  if (/reject|denied|cancel|closed|declin/i.test(message)) {
    return new Error("Wallet declined the signature.");
  }
  return error instanceof Error ? error : new Error(message);
}

function units(amount: number, decimals: number): bigint {
  if (!(amount > 0)) throw new Error("Ticket size is not a real token amount");
  return parseUnits(amount.toFixed(decimals), decimals);
}

function deadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + 180);
}

async function sendFrom(
  account: PrivateKeyAccount,
  tx: { to: `0x${string}`; data?: Hex; value?: bigint },
): Promise<string> {
  const client = cronosClient();
  const signAndSend = async (gas?: bigint) => {
    const prepared = await client.prepareTransactionRequest({
      account,
      chain: cronos,
      to: tx.to,
      data: tx.data,
      value: tx.value ?? 0n,
      ...(gas ? { gas } : {}),
    });
    const serialized = await account.signTransaction(prepared as Parameters<PrivateKeyAccount["signTransaction"]>[0]);
    return client.sendRawTransaction({ serializedTransaction: serialized });
  };
  try {
    return await signAndSend();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/estimate|gas|intrinsic/i.test(message)) throw cronosError(error);
    try {
      return await signAndSend(450_000n);
    } catch (retry) {
      throw cronosError(retry);
    }
  }
}

async function userSend(
  provider: EthereumProvider,
  from: string,
  to: `0x${string}`,
  value?: bigint,
  data?: Hex,
): Promise<string> {
  try {
    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from,
          to,
          value: value && value > 0n ? `0x${value.toString(16)}` : undefined,
          data,
        },
      ],
    });
    if (typeof hash !== "string" || !hash.startsWith("0x")) throw new Error("Wallet did not return a signature");
    return hash;
  } catch (error) {
    throw cronosError(error);
  }
}

async function quoteOut(amountIn: bigint, path: readonly [`0x${string}`, `0x${string}`]): Promise<bigint> {
  const amounts = await cronosClient().readContract({
    address: VVS_ROUTER,
    abi: quoteAbi,
    functionName: "getAmountsOut",
    args: [amountIn, [...path]],
  });
  const out = amounts[amounts.length - 1] ?? 0n;
  if (out <= 0n) throw new Error("VVS has no route for this ticket");
  return out;
}

async function ensureAllowance(account: PrivateKeyAccount, token: `0x${string}`, amount: bigint): Promise<void> {
  const allowance = await cronosClient().readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, VVS_ROUTER],
  });
  if (allowance >= amount) return;
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [VVS_ROUTER, amount],
  });
  await sendFrom(account, { to: token, data });
}

function inputDecimals(swap: VvsSwap): number {
  return swap.method === "swapExactETHForTokens" || swap.approve === undefined ? 18 : swap.path[0] === USDC ? 6 : 18;
}

async function sendVvsSwap(account: PrivateKeyAccount, swap: VvsSwap, mark: number): Promise<ChainFill> {
  const amountIn = units(swap.amountIn, inputDecimals(swap));
  if (swap.approve) await ensureAllowance(account, swap.approve, amountIn);
  const quoted = await quoteOut(amountIn, swap.path);
  const call = buildVvsCall({
    method: swap.method,
    amountIn,
    amountOutMin: minOut(quoted),
    path: swap.path,
    recipient: account.address,
    deadline: deadline(),
  });
  const signature = await sendFrom(account, call);
  const buyingCro = swap.method === "swapExactTokensForETH";
  if (buyingCro) {
    const outQty = Number(formatUnits(quoted, 18));
    const price = outQty > 0 ? swap.amountIn / outQty : mark;
    return { signature, qty: outQty, price, tokenDecimals: 18 };
  }
  const usdcOut = Number(formatUnits(quoted, 6));
  const price = swap.amountIn > 0 ? usdcOut / swap.amountIn : mark;
  return { signature, qty: swap.amountIn, price, tokenDecimals: 18 };
}

async function settleCronos(session: CronosSession, order: ChainOrder): Promise<ChainFill> {
  const account = cronosTradingAccount(session.address);
  if (!account) throw new Error("Arm the bot and approve the wallet signature before a swap can be sent.");
  if (order.side === "short") throw new Error("Wallet swaps are spot buys and sells. Shorts are not sent to the wallet.");
  const leverage = order.leverage ?? 1;
  if (order.kind === "open") {
    const collateral = leverage > 1 ? (order.collateralUsd ?? order.notionalUsd / Math.max(leverage, 1)) : order.notionalUsd;
    const balances = await readCronosBalances(account.address);
    const price = order.price || balances.solPriceUsd || 0;
    const plan = planCronosOpen(collateral, balances.usdc, balances.sol);
    const fill = await sendVvsSwap(account, plan.swap, price);
    return leverage > 1 ? marginFill(fill, leverage, collateral) : fill;
  }

  const balances = await readCronosBalances(account.address);
  const wrapped = await readWcroBalance(account.address);
  const native = sellQty(order.qty, Math.max(0, balances.sol - GAS_CRO));
  const wrappedQty = sellQty(order.qty, wrapped);
  const plan = planVvsSell(native, wrappedQty);
  return sendVvsSwap(account, plan, order.price || balances.solPriceUsd || 0);
}

export function cronosExecutor(session: CronosSession): ChainExecutor {
  return (order) => settleCronos(session, order);
}

export async function cronosBudget(session?: CronosSession | null): Promise<WalletBudget | null> {
  if (!session) return null;
  const account = cronosTradingAccount(session.address);
  const address = account?.address ?? session.address;
  try {
    const live = await readCronosBalances(address);
    return { usdc: live.usdc, sol: live.sol, solPriceUsd: live.solPriceUsd ?? session.solPriceUsd ?? 0 };
  } catch (error) {
    if (!account) return { usdc: session.usdc, sol: session.sol, solPriceUsd: session.solPriceUsd ?? 0 };
    const message = error instanceof Error ? error.message : "balance read failed";
    throw new Error(`Could not read the CRO trading key, so no swap was sent. ${message}`);
  }
}

export async function authorizeCronos(session: CronosSession): Promise<ArmAuth> {
  const existing = cronosTradingAccount(session.address);
  const before = existing ? await readCronosBalances(existing.address).catch(() => null) : null;
  if (existing && !before) {
    throw new Error("Could not read the trading account, so no more CRO or USDC was moved.");
  }
  if (tradingKeyCoversSpend(before, BOT_MIN_CRO)) {
    return {
      signature: "reused",
      botAddress: existing?.address ?? "",
      reused: true,
      equityUsd: before?.equityUsd ?? 0,
      depositedUsd: 0,
    };
  }
  const account = loadOrCreateCronosKey(session.address);
  const live = await readCronosBalances(session.address);
  const plan = planCronosArm(live.sol, live.usdc);
  let signature = "";
  if (plan.croToBot > 0) {
    signature = await userSend(session.provider, session.address, account.address, units(plan.croToBot, 18));
  }
  if (plan.usdcToBot > 0) {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [account.address, units(plan.usdcToBot, 6)],
    });
    signature = await userSend(session.provider, session.address, USDC, undefined, data);
  }
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const after = await readCronosBalances(account.address).catch(() => before);
  const equityUsd = after?.equityUsd ?? 0;
  const depositedUsd = Math.max(0, equityUsd - (before?.equityUsd ?? 0));
  return { signature: signature || "reused", botAddress: account.address, reused: false, equityUsd, depositedUsd };
}

export async function reclaimCronos(ownerAddress: string, keepCro = 0): Promise<string | null> {
  const account = cronosTradingAccount(ownerAddress);
  if (!account) return null;
  const held = await readCronosBalances(account.address);
  const owner = ownerAddress as `0x${string}`;
  let last: string | null = null;
  if (held.usdc > 0.01) {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [owner, units(held.usdc, 6)],
    });
    last = await sendFrom(account, { to: USDC, data });
  }
  const keep = Math.max(keepCro, 0.2);
  const sendCro = held.sol - keep;
  if (sendCro > 0.05) {
    last = await sendFrom(account, { to: owner, value: units(sendCro, 18) });
  }
  return last;
}

export async function sendCronosProfit(
  ownerAddress: string,
  principalUsd: number,
  keepCro = 0.5,
): Promise<{ signature: string; profitUsd: number }> {
  const account = cronosTradingAccount(ownerAddress);
  if (!account) throw new Error("Arm the bot before sending profit.");
  const held = await readCronosBalances(account.address);
  const plan = planProfitWithdrawal({
    usdc: held.usdc,
    sol: held.sol,
    solPriceUsd: held.solPriceUsd ?? 0,
    principalUsd,
    keepSol: keepCro,
  });
  const owner = ownerAddress as `0x${string}`;
  let signature = "";
  if (plan.usdc > 0) {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [owner, units(plan.usdc, 6)],
    });
    signature = await sendFrom(account, { to: USDC, data });
  }
  if (plan.sol > 0) {
    signature = await sendFrom(account, { to: owner, value: units(plan.sol, 18) });
  }
  if (!signature) throw new Error("Could not send the trading profit to the wallet");
  return { signature, profitUsd: plan.profitUsd };
}

export async function cronosSnapshot(owner: string): Promise<TradingSnap | null> {
  const account = cronosTradingAccount(owner);
  if (!account) return null;
  const held = await readCronosBalances(account.address).catch(() => null);
  if (!held || (held.usdc < 1 && held.sol < BOT_MIN_CRO)) return null;
  return { address: account.address, sol: held.sol, usdc: held.usdc, equityUsd: held.equityUsd };
}

export function cronosBudgetAddress(owner: string): string {
  return cronosTradingAccount(owner)?.address ?? owner;
}
