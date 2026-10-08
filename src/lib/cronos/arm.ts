import { DEFAULT_ARM_FUNDS_USD, normalizeCronosQuote, usdcToLoad, type CronosQuote } from "@/lib/deskSettings";
import { formatCro } from "./balance";
import { BOT_MIN_CRO, USER_KEEP_CRO } from "./constants";

export interface CronosArmPlan {
  croToBot: number;
  wcroToBot: number;
  usdcToBot: number;
}

function round(n: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function keepOnWallet(cro: number): number {
  if (cro >= USER_KEEP_CRO + BOT_MIN_CRO) return USER_KEEP_CRO;
  return Math.min(USER_KEEP_CRO, Math.max(0.4, round(cro - BOT_MIN_CRO, 6)));
}

/**
 * Arming moves a trading balance to a key this browser can sign with.
 * Native CRO and wrapped CRO both count. Cronos POS CRO does not — WolfSwap
 * cannot spend it until it is sent to Cronos EVM.
 */
export interface CronosArmFunds {
  armFundsUsd?: number;
  alreadyUsdc?: number;
  alreadyNative?: number;
  cronosQuote?: CronosQuote;
  croPriceUsd?: number;
}

function refuseThinEvm(cro: number, wcro: number, posCro: number): never {
  const evm = cro + wcro;
  if (posCro > 0 && evm < 3) {
    throw new Error(
      `The connected wallet shows ${formatCro(posCro)} on Cronos POS. In the Onchain wallet, send that CRO to Cronos EVM, then arm.`,
    );
  }
  if (evm > 0) {
    throw new Error(
      `This Cronos EVM account has ${formatCro(evm)}. Need about 3 CRO on Cronos EVM so arming can pay for swaps.`,
    );
  }
  throw new Error("Need about 3 CRO on Cronos EVM in this wallet so arming can pay for swaps.");
}

export function planCronosArm(cro: number, usdc: number, wcro = 0, posCro = 0, funds: CronosArmFunds = {}): CronosArmPlan {
  const want = funds.armFundsUsd ?? DEFAULT_ARM_FUNDS_USD;
  const alreadyUsdc = funds.alreadyUsdc ?? 0;
  const alreadyCro = funds.alreadyNative ?? 0;
  const quote = normalizeCronosQuote(funds.cronosQuote);
  const keep = keepOnWallet(Math.max(0, cro));
  const croAvailable = cro > keep ? round(cro - keep, 6) : 0;

  if (quote === "cro") {
    const px = funds.croPriceUsd ?? 0;
    if (!(px > 0)) throw new Error("Need a CRO price to load CRO instead of USDC.");
    const wantCro = want / px;
    const croNeed = Math.max(0, wantCro + BOT_MIN_CRO - alreadyCro);
    const croToBot = croNeed > 0 ? Math.min(croAvailable, croNeed) : 0;
    const wcroNeed = Math.max(0, wantCro + BOT_MIN_CRO - alreadyCro - croToBot);
    const wcroToBot = wcroNeed > 0 && wcro > 0.000001 ? round(Math.min(wcro, wcroNeed), 6) : 0;
    if (croToBot + alreadyCro + wcroToBot < BOT_MIN_CRO) refuseThinEvm(cro, wcro, posCro);
    if (alreadyCro + croToBot + wcroToBot + 1e-6 < wantCro + BOT_MIN_CRO) {
      const evm = cro + wcro;
      throw new Error(
        `Need $${want} of CRO to load this trading size. This wallet has ${formatCro(evm)} (~$${(evm * px).toFixed(2)}).`,
      );
    }
    return { croToBot, wcroToBot, usdcToBot: 0 };
  }

  const usdcToBot = usdcToLoad(usdc, want, alreadyUsdc);
  const croNeed = Math.max(0, BOT_MIN_CRO - alreadyCro);
  const croToBot = croNeed > 0 ? Math.min(croAvailable, croNeed) : 0;
  const wcroNeed = Math.max(0, BOT_MIN_CRO - alreadyCro - croToBot);
  const wcroToBot = wcroNeed > 0 && wcro > 0.000001 ? round(Math.min(wcro, wcroNeed), 6) : 0;
  if (croToBot + alreadyCro < BOT_MIN_CRO && wcroToBot + alreadyCro < BOT_MIN_CRO) {
    refuseThinEvm(cro, wcro, posCro);
  }
  if (alreadyUsdc + usdcToBot + 0.5 < want) {
    throw new Error(`Need $${want} USDC to load this trading size. This wallet has $${usdc.toFixed(2)}.`);
  }
  return { croToBot, wcroToBot, usdcToBot };
}

export function minOut(quoted: bigint, slippageBps = 80): bigint {
  if (quoted <= 0n) return 0n;
  return (quoted * BigInt(10_000 - slippageBps)) / 10_000n;
}
