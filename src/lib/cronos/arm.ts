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
export function planCronosArm(cro: number, usdc: number, wcro = 0, posCro = 0): CronosArmPlan {
  const usdcToBot = usdc > 0.5 ? round(usdc, 6) : 0;
  const wcroToBot = wcro > 0.000001 ? round(wcro, 6) : 0;
  const keep = keepOnWallet(Math.max(0, cro));
  const croToBot = cro > keep ? round(cro - keep, 6) : 0;
  if (croToBot < BOT_MIN_CRO && wcroToBot < BOT_MIN_CRO) {
    if (posCro >= 3 && cro + wcro < 3) {
      throw new Error(
        `The wallet is holding ${posCro >= 1000 ? posCro.toFixed(1) : posCro.toFixed(3)} CRO on Cronos POS. Send it to Cronos EVM, then arm.`,
      );
    }
    throw new Error("Need about 3 CRO on Cronos EVM in this wallet so arming can pay for swaps.");
  }
  return { croToBot, wcroToBot, usdcToBot };
}

export function minOut(quoted: bigint, slippageBps = 80): bigint {
  if (quoted <= 0n) return 0n;
  return (quoted * BigInt(10_000 - slippageBps)) / 10_000n;
}
