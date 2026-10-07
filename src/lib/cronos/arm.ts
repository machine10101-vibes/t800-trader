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

/**
 * Arming moves a trading balance to a key this browser can sign with.
 * Native CRO and wrapped CRO both count. The user wallet keeps a little native CRO for gas.
 */
export function planCronosArm(cro: number, usdc: number, wcro = 0): CronosArmPlan {
  const usdcToBot = usdc > 0.5 ? round(usdc, 6) : 0;
  const wcroToBot = wcro > 0.000001 ? round(wcro, 6) : 0;
  let croToBot = cro > USER_KEEP_CRO ? round(cro - USER_KEEP_CRO, 6) : 0;
  if (croToBot < BOT_MIN_CRO) {
    const need = round(BOT_MIN_CRO - croToBot, 6);
    const leftOnUser = round(cro - croToBot - need, 6);
    if (leftOnUser >= 0.5) croToBot = round(croToBot + need, 6);
  }
  if (croToBot < BOT_MIN_CRO && wcroToBot < BOT_MIN_CRO) {
    throw new Error("Need about 3 CRO in the wallet so arming can pay for swaps.");
  }
  if (croToBot + wcroToBot < 2 && usdcToBot === 0) {
    throw new Error("Need at least 4 CRO, or USDC plus 3 CRO, before arming can authorize swaps.");
  }
  return { croToBot, wcroToBot, usdcToBot };
}

export function minOut(quoted: bigint, slippageBps = 80): bigint {
  if (quoted <= 0n) return 0n;
  return (quoted * BigInt(10_000 - slippageBps)) / 10_000n;
}
