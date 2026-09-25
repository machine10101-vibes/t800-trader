import { BOT_MIN_CRO, USER_KEEP_CRO } from "./constants";

export interface CronosArmPlan {
  croToBot: number;
  usdcToBot: number;
}

function round(n: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

/**
 * Arming moves a trading balance to a key this browser can sign with.
 * The user wallet keeps a little CRO so the funding transaction and a later disarm can pay gas.
 */
export function planCronosArm(cro: number, usdc: number): CronosArmPlan {
  const usdcToBot = usdc > 0.5 ? round(usdc, 6) : 0;
  let croToBot = cro > USER_KEEP_CRO ? round(cro - USER_KEEP_CRO, 6) : 0;
  if (croToBot < BOT_MIN_CRO) {
    const need = round(BOT_MIN_CRO - croToBot, 6);
    const leftOnUser = round(cro - croToBot - need, 6);
    if (leftOnUser >= 0.5) croToBot = round(croToBot + need, 6);
  }
  if (croToBot < BOT_MIN_CRO) {
    throw new Error("Need about 3 CRO in the wallet so arming can pay for swaps.");
  }
  if (croToBot < 2 && usdcToBot === 0) {
    throw new Error("Need at least 4 CRO, or USDC plus 3 CRO, before arming can authorize swaps.");
  }
  return { croToBot, usdcToBot };
}

export function minOut(quoted: bigint, slippageBps = 80): bigint {
  if (quoted <= 0n) return 0n;
  return (quoted * BigInt(10_000 - slippageBps)) / 10_000n;
}
