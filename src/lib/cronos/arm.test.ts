import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { minOut, planCronosArm } from "./arm";

function planCronosArmError(cro: number, usdc: number, wcro = 0, posCro = 0): string {
  try {
    planCronosArm(cro, usdc, wcro, posCro);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("cronos arm", () => {
  it("keeps gas on the user wallet and moves the rest", () => {
    const plan = planCronosArm(100, 25);
    assert.equal(plan.croToBot, 98);
    assert.equal(plan.usdcToBot, 25);
    assert.equal(plan.wcroToBot, 0);
  });

  it("tops the trading key up to 1 CRO when the user can still pay gas", () => {
    const plan = planCronosArm(3.2, 12);
    assert.ok(plan.croToBot >= 1);
    assert.equal(plan.usdcToBot, 12);
  });

  it("moves wrapped CRO when that is the balance the wallet is showing", () => {
    const plan = planCronosArm(0.4, 0, 20);
    assert.equal(plan.croToBot, 0);
    assert.equal(plan.wcroToBot, 20);
  });

  it("arms a 3 CRO Cronos EVM wallet without asking for a fourth coin", () => {
    const plan = planCronosArm(3, 0);
    assert.ok(plan.croToBot >= 1);
    assert.ok(plan.croToBot + 0.4 <= 3);
    assert.equal(plan.usdcToBot, 0);
  });

  it("arms a 200 CRO Cronos EVM wallet", () => {
    const plan = planCronosArm(200, 0);
    assert.equal(plan.croToBot, 198);
    assert.equal(plan.wcroToBot, 0);
  });

  it("tells the user to send Cronos POS CRO to Cronos EVM", () => {
    assert.throws(() => planCronosArm(0, 0, 0, 40), /40.000 CRO on Cronos POS/);
    const twoHundred = planCronosArmError(0, 0, 0, 200);
    assert.match(twoHundred, /200.000 CRO on Cronos POS/);
    assert.doesNotMatch(twoHundred, /Need about 3 CRO/);
  });

  it("refuses a wallet that cannot pay Cronos gas", () => {
    assert.throws(() => planCronosArm(0.4, 0), /This Cronos EVM account has 0.400 CRO/);
    assert.throws(() => planCronosArm(0, 0), /Need about 3 CRO on Cronos EVM/);
  });

  it("haircuts a quoted swap by the slippage band", () => {
    assert.equal(minOut(10_000n, 80), 9_920n);
    assert.equal(minOut(0n), 0n);
  });
});
