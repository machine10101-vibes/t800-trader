import type { ArmAuth, TradingSnap } from "@/lib/solana/authorize";
import { planProfitWithdrawal } from "@/lib/solana/authorize";
import { marginFill } from "@/lib/trading/leverage";
import { sellQty } from "@/lib/solana/swap";
import type { WalletBudget } from "@/lib/trading/risk";
import type { ChainExecutor, ChainFill, ChainOrder } from "@/lib/types";
import { encodeFunctionData, erc20Abi, formatUnits, parseUnits, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { cronos } from "viem/chains";
import { minOut, planCronosArm } from "./arm";
import { BOT_MIN_CRO, GAS_CRO, USDC, VVS_ROUTER, WCRO } from "./constants";
import { cronosClient, readCronosBalances, readWcroBalance, type CronosSession, type EthereumProvider } from "./wallet";

const routerAbi = [
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
] as const;

const wcroAbi = [
  { name: "deposit", type: "function", stateMutability: "payable", inputs: [], outputs: [] },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "wad", type: "uint256" }],
    outputs: [],
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
  try {
    const prepared = await client.prepareTransactionRequest({
      account,
      chain: cronos,
      to: tx.to,
      data: tx.data,
      value: tx.value ?? 0n,
    });
    const serialized = await account.signTransaction(prepared as Parameters<PrivateKeyAccount["signTransaction"]>[0]);
    return await client.sendRawTransaction({ serializedTransaction: serialized });
  } catch (error) {
    throw cronosError(error);
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
    abi: routerAbi,
    functionName: "getAmountsOut",
    args: [amountIn, [...path]],
  });
  const out = amounts[amounts.length - 1] ?? 0n;
  if (out <= 0n) throw new Error("VVS has no route for this ticket");
  return out;
}

async function ensureUsdcAllowance(account: PrivateKeyAccount, amount: bigint): Promise<void> {
  const allowance = await cronosClient().readContract({
    address: USDC,
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
  await sendFrom(account, { to: USDC, data });
}

async function swapUsdcForCro(account: PrivateKeyAccount, usdcAmount: number): Promise<ChainFill> {
  const amountIn = units(usdcAmount, 6);
  await ensureUsdcAllowance(account, amountIn);
  const quoted = await quoteOut(amountIn, [USDC, WCRO]);
  const data = encodeFunctionData({
    abi: routerAbi,
    functionName: "swapExactTokensForETH",
    args: [amountIn, minOut(quoted), [USDC, WCRO], account.address, deadline()],
  });
  const signature = await sendFrom(account, { to: VVS_ROUTER, data });
  const outQty = Number(formatUnits(quoted, 18));
  const price = outQty > 0 ? usdcAmount / outQty : 0;
  return { signature, qty: outQty, price, tokenDecimals: 18 };
}

async function swapCroForUsdc(account: PrivateKeyAccount, croAmount: number, mark: number): Promise<ChainFill> {
  const amountIn = units(croAmount, 18);
  const quoted = await quoteOut(amountIn, [WCRO, USDC]);
  const data = encodeFunctionData({
    abi: routerAbi,
    functionName: "swapExactETHForTokens",
    args: [minOut(quoted), [WCRO, USDC], account.address, deadline()],
  });
  const signature = await sendFrom(account, { to: VVS_ROUTER, data, value: amountIn });
  const usdcOut = Number(formatUnits(quoted, 6));
  const price = croAmount > 0 ? usdcOut / croAmount : mark;
  return { signature, qty: croAmount, price, tokenDecimals: 18 };
}

async function wrapCro(account: PrivateKeyAccount, croAmount: number): Promise<string> {
  const data = encodeFunctionData({ abi: wcroAbi, functionName: "deposit" });
  return sendFrom(account, { to: WCRO, data, value: units(croAmount, 18) });
}

async function unwrapCro(account: PrivateKeyAccount, croAmount: number): Promise<string> {
  const data = encodeFunctionData({
    abi: wcroAbi,
    functionName: "withdraw",
    args: [units(croAmount, 18)],
  });
  return sendFrom(account, { to: WCRO, data });
}

async function settleCronos(session: CronosSession, order: ChainOrder): Promise<ChainFill> {
  const account = cronosTradingAccount(session.address);
  if (!account) throw new Error("Arm the bot and approve the wallet signature before a swap can be sent.");
  if (order.side === "short") throw new Error("Wallet swaps are spot buys and sells. Shorts are not sent to the wallet.");
  const leverage = order.leverage ?? 1;
  if (order.kind === "open") {
    const collateral = leverage > 1 ? (order.collateralUsd ?? order.notionalUsd / Math.max(leverage, 1)) : order.notionalUsd;
    if (!(collateral > 0)) throw new Error("Ticket notional is empty");
    const balances = await readCronosBalances(account.address);
    let fill: ChainFill;
    if (balances.usdc + 1e-6 >= collateral) {
      fill = await swapUsdcForCro(account, collateral);
    } else {
      const price = balances.solPriceUsd ?? order.price;
      if (!(price > 0)) throw new Error("USDC does not cover this ticket, and the CRO price is missing.");
      const croNeed = collateral / price;
      if (balances.sol - GAS_CRO < croNeed) {
        throw new Error(
          `Trading key has ${balances.usdc.toFixed(2)} USDC and ${balances.sol.toFixed(3)} CRO. This ticket needs about $${collateral.toFixed(2)}.`,
        );
      }
      const signature = await wrapCro(account, croNeed);
      fill = { signature, qty: croNeed, price, tokenDecimals: 18 };
    }
    return leverage > 1 ? marginFill(fill, leverage, collateral) : fill;
  }

  const wrapped = await readWcroBalance(account.address);
  if (wrapped > 0) {
    const qty = sellQty(order.qty, wrapped);
    if (!(qty > 0)) throw new Error("ALREADY_FLAT: trading key does not hold this token");
    const signature = await unwrapCro(account, qty);
    return { signature, qty, price: order.price, tokenDecimals: 18 };
  }
  const balances = await readCronosBalances(account.address);
  const held = Math.max(0, balances.sol - GAS_CRO);
  const qty = sellQty(order.qty, held);
  if (!(qty > 0)) throw new Error("ALREADY_FLAT: trading key does not hold this token");
  return swapCroForUsdc(account, qty, order.price || balances.solPriceUsd || 0);
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
  } catch {
    return account
      ? { usdc: 0, sol: 0, solPriceUsd: session.solPriceUsd ?? 0 }
      : { usdc: session.usdc, sol: session.sol, solPriceUsd: session.solPriceUsd ?? 0 };
  }
}

export async function authorizeCronos(session: CronosSession): Promise<ArmAuth> {
  const account = loadOrCreateCronosKey(session.address);
  const before = await readCronosBalances(account.address).catch(() => null);
  const reused = Boolean(before && (before.usdc >= 1 || before.sol >= BOT_MIN_CRO));
  if (reused && before && before.sol >= BOT_MIN_CRO) {
    return {
      signature: "reused",
      botAddress: account.address,
      reused: true,
      equityUsd: before.equityUsd,
      depositedUsd: 0,
    };
  }
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
