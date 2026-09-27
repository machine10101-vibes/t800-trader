import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { USDC_MINT } from "@/lib/market/universe";
import { PERP_MIN_COLLATERAL_USD, PERP_RENT_SOL } from "@/lib/trading/leverage";
import { MIN_TRADE_USD, SOL_FEE_RESERVE } from "@/lib/trading/risk";
import { broadcastTransaction, readBalances, solanaRpc, type WalletSession } from "./wallet";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** Stays in Phantom so the arm transaction and a later disarm can pay fees. */
const USER_KEEP_SOL = 0.02;
/** The trading key needs this much SOL to land Jupiter swaps. */
const BOT_MIN_SOL = 0.01;

export interface ArmPlan {
  solToBot: number;
  usdcToBot: number;
}

/**
 * One Jupiter swap spends a single mint, and only the owner can sign it.
 * Arming therefore moves a trading balance to a key this browser can sign with.
 */
export function planAuthorization(sol: number, usdc: number): ArmPlan {
  const usdcToBot = usdc > 0.5 ? round(usdc, 6) : 0;
  let solToBot = sol > USER_KEEP_SOL ? round(sol - USER_KEEP_SOL, 9) : 0;
  if (solToBot < BOT_MIN_SOL) {
    const need = round(BOT_MIN_SOL - solToBot, 9);
    const leftOnUser = round(sol - solToBot - need, 9);
    if (leftOnUser >= 0.005) solToBot = round(solToBot + need, 9);
  }
  if (solToBot < BOT_MIN_SOL) {
    throw new Error("Need about 0.025 SOL in the wallet so arming can pay for swaps.");
  }
  if (solToBot < 0.02 && usdcToBot === 0) {
    throw new Error("Need at least 0.04 SOL, or USDC plus 0.025 SOL, before arming can authorize swaps.");
  }
  return { solToBot, usdcToBot };
}

function round(n: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function storageKey(owner: string): string {
  return `t800-trader-signer:${owner}`;
}

export function tradingKeypair(owner: string): Keypair | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(owner));
    if (!raw) return null;
    const bytes = Uint8Array.from(JSON.parse(raw) as number[]);
    if (bytes.length !== 64) return null;
    return Keypair.fromSecretKey(bytes);
  } catch {
    return null;
  }
}

export function loadOrCreateTradingKey(owner: string): Keypair {
  const existing = tradingKeypair(owner);
  if (existing) return existing;
  if (typeof window === "undefined") throw new Error("Arm the bot from the browser so the wallet can sign.");
  const created = Keypair.generate();
  window.localStorage.setItem(storageKey(owner), JSON.stringify(Array.from(created.secretKey)));
  return created;
}

function associatedToken(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
}

function createAtaIdempotent(payer: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  const ata = associatedToken(owner, mint);
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

function transferChecked(
  source: PublicKey,
  mint: PublicKey,
  dest: PublicKey,
  owner: PublicKey,
  amount: bigint,
  decimals: number,
): TransactionInstruction {
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0);
  data.writeBigUInt64LE(amount, 1);
  data.writeUInt8(decimals, 9);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

async function latestBlockhash(): Promise<string> {
  const hash = await solanaRpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  if (!hash.value?.blockhash) throw new Error("Solana did not return a blockhash");
  return hash.value.blockhash;
}

const ATA_RENT_LAMPORTS = 2_039_280n;
const FEE_BUFFER_LAMPORTS = 20_000n;
const BOT_MIN_LAMPORTS = 10_000_000n;
const USER_MIN_LAMPORTS = 5_000_000n;

interface ChainHoldings {
  lamports: bigint;
  usdc: bigint;
}

async function chainHoldings(owner: PublicKey): Promise<ChainHoldings> {
  const usdcMint = new PublicKey(USDC_MINT);
  const [bal, token] = await Promise.all([
    solanaRpc<{ value: number }>("getBalance", [owner.toBase58()]),
    solanaRpc<{
      value?: { data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } | null;
    }>("getAccountInfo", [associatedToken(owner, usdcMint).toBase58(), { encoding: "jsonParsed" }]),
  ]);
  const raw = token.value?.data?.parsed?.info?.tokenAmount?.amount;
  return {
    lamports: BigInt(bal.value),
    usdc: raw && /^\d+$/.test(raw) ? BigInt(raw) : 0n,
  };
}

async function accountExists(address: PublicKey): Promise<boolean> {
  const acc = await solanaRpc<{ value: unknown }>("getAccountInfo", [address.toBase58(), { encoding: "base64" }]);
  return Boolean(acc.value);
}

/**
 * The trading account can already pay for swaps. A later refresh or arm must not
 * move more SOL or USDC out of the wallet.
 * Solana passes the Jupiter $10 floor so a key that cannot open 5x or 10x is topped up.
 */
export function tradingKeyCoversSpend(
  held: { sol: number; usdc: number; equityUsd: number } | null,
  minNative = BOT_MIN_SOL,
  minEquityUsd = MIN_TRADE_USD,
): boolean {
  if (!held || !(held.sol >= minNative)) return false;
  if (!(minEquityUsd > MIN_TRADE_USD)) {
    return held.equityUsd >= MIN_TRADE_USD || held.usdc >= 1 || held.sol >= minNative * 4;
  }
  if (held.usdc + 1e-6 >= minEquityUsd || held.equityUsd + 1e-6 >= minEquityUsd) {
    const price = held.sol > 0 ? Math.max(0, held.equityUsd - Math.max(0, held.usdc)) / held.sol : 0;
    if (held.usdc + 1e-6 >= minEquityUsd) return true;
    if (!(price > 0)) return held.sol + 1e-9 >= 0.13;
    const postable = Math.max(0, held.sol - SOL_FEE_RESERVE - PERP_RENT_SOL) * price;
    return postable + 1e-6 >= minEquityUsd;
  }
  return !(held.equityUsd > 0) && held.sol + 1e-9 >= 0.13;
}

async function confirmSignature(signature: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const status = await solanaRpc<{ value: ({ confirmationStatus?: string; err?: unknown } | null)[] }>(
      "getSignatureStatuses",
      [[signature], { searchTransactionHistory: true }],
    ).catch(() => null);
    const row = status?.value?.[0];
    if (row?.err) throw new Error("The wallet signature landed, but Solana rejected the arm transaction.");
    if (row?.confirmationStatus === "confirmed" || row?.confirmationStatus === "finalized") return;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error("The arm signature was sent, but it has not confirmed yet. Arm again in a moment.");
}

async function walletSignature(session: WalletSession, tx: Transaction): Promise<string> {
  const provider = session.provider;
  let signature: string;
  if (provider.signAndSendTransaction) {
    const signed = await provider.signAndSendTransaction(tx);
    signature = typeof signed === "string" ? signed : signed.signature;
  } else if (provider.signTransaction) {
    const signed = await provider.signTransaction(tx);
    signature = await broadcastTransaction(signed.serialize());
  } else {
    throw new Error("This wallet cannot sign a Solana transaction");
  }
  if (!signature) throw new Error("Wallet did not return a signature");
  return signature;
}

export interface ArmAuth {
  signature: string;
  botAddress: string;
  reused: boolean;
  /** Trading-key equity after this arm, in USD. */
  equityUsd: number;
  /** New USD that moved onto the trading key. Zero when the key was already funded. */
  depositedUsd: number;
}

const MIN_PROFIT_USD = 1;

/** Cash on the trading key above the deposit. Open tickets are not cash, so they are not included. */
export function tradingProfitUsd(equityUsd: number, principalUsd: number | null | undefined): number {
  if (principalUsd == null || !Number.isFinite(principalUsd) || !Number.isFinite(equityUsd)) return 0;
  return Math.max(0, equityUsd - principalUsd);
}

export function planProfitWithdrawal(input: {
  usdc: number;
  sol: number;
  solPriceUsd: number;
  principalUsd: number;
  keepSol?: number;
}): { usdc: number; sol: number; profitUsd: number } {
  const price = input.solPriceUsd > 0 ? input.solPriceUsd : 0;
  const keep = Math.max(input.keepSol ?? 0.01, 0.008);
  const equity = Math.max(0, input.usdc) + Math.max(0, input.sol) * price;
  const profit = equity - input.principalUsd;
  if (!(profit >= MIN_PROFIT_USD)) {
    throw new Error("No trading profit to send yet. The bot keeps the balance it is still using.");
  }
  let usdcSend = Math.min(Math.max(0, input.usdc), profit);
  if (usdcSend < 0.01) usdcSend = 0;
  usdcSend = round(usdcSend, 6);
  const left = profit - usdcSend;
  const solFree = Math.max(0, input.sol - keep);
  let solSend = price > 0 ? Math.min(solFree, left / price) : 0;
  if (solSend * price < 0.5) solSend = 0;
  solSend = round(solSend, 9);
  const sent = usdcSend + solSend * price;
  if (sent < MIN_PROFIT_USD) {
    throw new Error("The bot is keeping that SOL for swap fees. Close a winning ticket, then send the USDC profit.");
  }
  return { usdc: usdcSend, sol: solSend, profitUsd: round(sent, 2) };
}

let arming: Promise<ArmAuth> | null = null;

/** Ask the connected wallet to sign the transaction that lets this browser send the swaps. */
export function authorizeTrading(session: WalletSession): Promise<ArmAuth> {
  if (arming) return arming;
  arming = authorizeTradingOnce(session).finally(() => {
    arming = null;
  });
  return arming;
}

async function authorizeTradingOnce(session: WalletSession): Promise<ArmAuth> {
  const existing = tradingKeypair(session.address);
  if (existing) {
    const held = await readBalances(existing.publicKey.toBase58()).catch(() => null);
    if (!held) {
      throw new Error("Could not read the trading account, so no more SOL or USDC was moved.");
    }
    if (tradingKeyCoversSpend(held, BOT_MIN_SOL, PERP_MIN_COLLATERAL_USD)) {
      return {
        signature: "already-authorized",
        botAddress: existing.publicKey.toBase58(),
        reused: true,
        equityUsd: held.equityUsd,
        depositedUsd: 0,
      };
    }
  }
  const bot = loadOrCreateTradingKey(session.address);
  const botAddress = bot.publicKey.toBase58();
  const owner = new PublicKey(session.address);
  const userChain = await chainHoldings(owner);
  const sol = Number(userChain.lamports) / 1_000_000_000;
  const usdc = Number(userChain.usdc) / 1_000_000;
  let plan: ArmPlan;
  try {
    plan = planAuthorization(sol, usdc);
  } catch (error) {
    const held = await readBalances(botAddress).catch(() => null);
    if (tradingKeyCoversSpend(held, BOT_MIN_SOL, PERP_MIN_COLLATERAL_USD)) {
      return { signature: "already-authorized", botAddress, reused: true, equityUsd: held?.equityUsd ?? 0, depositedUsd: 0 };
    }
    throw error;
  }

  const usdcMint = new PublicKey(USDC_MINT);
  let solLamports = BigInt(Math.round(plan.solToBot * 1_000_000_000));
  if (userChain.lamports < solLamports + USER_MIN_LAMPORTS) {
    solLamports = userChain.lamports > USER_MIN_LAMPORTS ? userChain.lamports - USER_MIN_LAMPORTS : 0n;
  }
  const usdcUnits = plan.usdcToBot > 0 ? userChain.usdc : 0n;
  if (usdcUnits > 0n) {
    const botAta = associatedToken(bot.publicKey, usdcMint);
    const rent = (await accountExists(botAta)) ? 0n : ATA_RENT_LAMPORTS;
    const extra = rent + FEE_BUFFER_LAMPORTS;
    if (userChain.lamports < solLamports + extra) {
      solLamports = userChain.lamports > extra ? userChain.lamports - extra : 0n;
    }
  }
  if (solLamports < BOT_MIN_LAMPORTS) {
    throw new Error("Need about 0.025 SOL in the wallet so arming can pay for swaps.");
  }

  const tx = new Transaction();
  tx.feePayer = owner;
  tx.recentBlockhash = await latestBlockhash();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }));
  tx.add(
    SystemProgram.transfer({
      fromPubkey: owner,
      toPubkey: bot.publicKey,
      lamports: Number(solLamports),
    }),
  );
  if (usdcUnits > 0n) {
    const source = associatedToken(owner, usdcMint);
    tx.add(createAtaIdempotent(owner, bot.publicKey, usdcMint));
    tx.add(transferChecked(source, usdcMint, associatedToken(bot.publicKey, usdcMint), owner, usdcUnits, 6));
  }
  const before = await readBalances(botAddress).catch(() => null);
  const signature = await walletSignature(session, tx);
  await confirmSignature(signature);
  const after = await readBalances(botAddress).catch(() => null);
  const equityUsd = after?.equityUsd ?? 0;
  const depositedUsd = Math.max(0, equityUsd - (before?.equityUsd ?? 0));
  return { signature, botAddress, reused: false, equityUsd, depositedUsd };
}

/** Send leftover USDC and SOL from the trading key back to the connected wallet. */
export async function reclaimTrading(ownerAddress: string, keepSol = 0): Promise<string | null> {
  const bot = tradingKeypair(ownerAddress);
  if (!bot) return null;
  const held = await chainHoldings(bot.publicKey);
  const owner = new PublicKey(ownerAddress);
  const usdcMint = new PublicKey(USDC_MINT);
  const feeKeep = BigInt(Math.round(Math.max(keepSol, 0.002) * 1_000_000_000));
  const usdcBack = held.usdc > 10_000n ? held.usdc : 0n;
  let solBack = held.lamports > feeKeep ? held.lamports - feeKeep : 0n;
  if (usdcBack > 0n && !(await accountExists(associatedToken(owner, usdcMint)))) {
    if (held.lamports < feeKeep + ATA_RENT_LAMPORTS + FEE_BUFFER_LAMPORTS) {
      throw new Error("The trading key needs a little more SOL before USDC can be returned.");
    }
    solBack = held.lamports - feeKeep - ATA_RENT_LAMPORTS;
  }
  if (solBack <= 0n && usdcBack === 0n) return null;

  const tx = new Transaction();
  tx.feePayer = bot.publicKey;
  tx.recentBlockhash = await latestBlockhash();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
  if (usdcBack > 0n) {
    tx.add(createAtaIdempotent(bot.publicKey, owner, usdcMint));
    tx.add(transferChecked(associatedToken(bot.publicKey, usdcMint), usdcMint, associatedToken(owner, usdcMint), bot.publicKey, usdcBack, 6));
  }
  if (solBack > 0n) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: bot.publicKey,
        toPubkey: owner,
        lamports: Number(solBack),
      }),
    );
  }
  tx.sign(bot);
  const sent = await broadcastTransaction(tx.serialize());
  if (!sent) throw new Error("Could not return the trading balance to the wallet");
  return sent;
}

/** Send cash profit from the trading key to the connected wallet. The deposit stays so the bot can keep trading. */
export async function sendTradingProfit(
  ownerAddress: string,
  principalUsd: number,
  keepSol = 0.01,
): Promise<{ signature: string; profitUsd: number }> {
  const bot = tradingKeypair(ownerAddress);
  if (!bot) throw new Error("Arm the bot before sending profit back to the wallet.");
  const priced = await readBalances(bot.publicKey.toBase58());
  const plan = planProfitWithdrawal({
    usdc: priced.usdc,
    sol: priced.sol,
    solPriceUsd: priced.solPriceUsd ?? 0,
    principalUsd,
    keepSol,
  });
  const held = await chainHoldings(bot.publicKey);
  const owner = new PublicKey(ownerAddress);
  const usdcMint = new PublicKey(USDC_MINT);
  let usdcUnits = BigInt(Math.floor(plan.usdc * 1_000_000 + 1e-6));
  if (usdcUnits > held.usdc) usdcUnits = held.usdc;
  const feeKeep = BigInt(Math.round(Math.max(keepSol, 0.008) * 1_000_000_000));
  let solBack = BigInt(Math.floor(plan.sol * 1_000_000_000));
  if (held.lamports < solBack + feeKeep) solBack = held.lamports > feeKeep ? held.lamports - feeKeep : 0n;
  if (usdcUnits > 0n && !(await accountExists(associatedToken(owner, usdcMint)))) {
    const rentNeed = feeKeep + ATA_RENT_LAMPORTS + FEE_BUFFER_LAMPORTS;
    if (held.lamports < solBack + rentNeed) {
      solBack = held.lamports > rentNeed ? held.lamports - rentNeed : 0n;
    }
  }
  if (usdcUnits <= 0n && solBack <= 0n) {
    throw new Error("No trading profit to send yet. The bot keeps the balance it is still using.");
  }

  const tx = new Transaction();
  tx.feePayer = bot.publicKey;
  tx.recentBlockhash = await latestBlockhash();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
  if (usdcUnits > 0n) {
    tx.add(createAtaIdempotent(bot.publicKey, owner, usdcMint));
    tx.add(transferChecked(associatedToken(bot.publicKey, usdcMint), usdcMint, associatedToken(owner, usdcMint), bot.publicKey, usdcUnits, 6));
  }
  if (solBack > 0n) {
    tx.add(SystemProgram.transfer({ fromPubkey: bot.publicKey, toPubkey: owner, lamports: Number(solBack) }));
  }
  tx.sign(bot);
  const sent = await broadcastTransaction(tx.serialize());
  if (!sent) throw new Error("Could not send the trading profit to the wallet");
  await confirmSignature(sent);
  return { signature: sent, profitUsd: plan.profitUsd };
}

export interface TradingSnap {
  address: string;
  sol: number;
  usdc: number;
  equityUsd: number;
}

/** Balance the browser key will spend. Null until that key actually holds a trading float. */
export async function tradingSnapshot(owner: string): Promise<TradingSnap | null> {
  const bot = tradingKeypair(owner);
  if (!bot) return null;
  const held = await readBalances(bot.publicKey.toBase58()).catch(() => null);
  if (!held || (held.usdc < 1 && held.sol < BOT_MIN_SOL)) return null;
  return { address: held.address, sol: held.sol, usdc: held.usdc, equityUsd: held.equityUsd };
}

/** The browser key is the swap signer once Arm has created it. An empty read must not fall back to Phantom. */
export function tradingBudgetAddress(owner: string): string {
  const bot = tradingKeypair(owner);
  return bot ? bot.publicKey.toBase58() : owner;
}
