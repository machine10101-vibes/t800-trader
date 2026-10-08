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
  it("moves the chosen USDC size and only enough CRO for gas", () => {
    const plan = planCronosArm(100, 80, 0, 0, { armFundsUsd: 50 });
    assert.equal(plan.croToBot, 1);
    assert.equal(plan.usdcToBot, 50);
    assert.equal(plan.wcroToBot, 0);
  });

  it("tops the trading key up to 1 CRO when the user can still pay gas", () => {
    const plan = planCronosArm(3.2, 50, 0, 0, { armFundsUsd: 50 });
    assert.ok(plan.croToBot >= 1);
    assert.equal(plan.usdcToBot, 50);
  });

  it("moves wrapped CRO when that is the balance the wallet is showing", () => {
    const plan = planCronosArm(0.4, 25, 20, 0, { armFundsUsd: 25 });
    assert.equal(plan.croToBot, 0);
    assert.ok(plan.wcroToBot >= 1);
    assert.equal(plan.usdcToBot, 25);
  });

  it("arms a 3 CRO Cronos EVM wallet with the chosen USDC size", () => {
    const plan = planCronosArm(3, 25, 0, 0, { armFundsUsd: 25 });
    assert.ok(plan.croToBot >= 1);
    assert.ok(plan.croToBot + 0.4 <= 3);
    assert.equal(plan.usdcToBot, 25);
  });

  it("does not dump a 200 CRO wallet onto the trading key", () => {
    const plan = planCronosArm(200, 150, 0, 0, { armFundsUsd: 150 });
    assert.equal(plan.croToBot, 1);
    assert.equal(plan.usdcToBot, 150);
    assert.equal(plan.wcroToBot, 0);
  });

  it("tells the user to send Cronos POS CRO to Cronos EVM", () => {
    assert.throws(() => planCronosArm(0, 0, 0, 40), /40.000 CRO on Cronos POS/);
    const twoHundred = planCronosArmError(0, 0, 0, 200);
    assert.match(twoHundred, /200.000 CRO on Cronos POS/);
    assert.doesNotMatch(twoHundred, /Need about 3 CRO/);
  });

  it("refuses a wallet that cannot load the chosen USDC size", () => {
    assert.throws(() => planCronosArm(100, 10, 0, 0, { armFundsUsd: 50 }), /\$50 USDC/);
  });

  it("loads CRO instead of USDC when the quote is CRO", () => {
    const plan = planCronosArm(600, 0, 0, 0, { armFundsUsd: 50, cronosQuote: "cro", croPriceUsd: 0.1 });
    assert.equal(plan.usdcToBot, 0);
    assert.ok(plan.croToBot > 500);
    assert.ok(plan.croToBot <= 501);
  });

  it("refuses a thin CRO wallet when the quote is CRO", () => {
    assert.throws(
      () => planCronosArm(20, 80, 0, 0, { armFundsUsd: 50, cronosQuote: "cro", croPriceUsd: 0.1 }),
      /\$50 of CRO/,
    );
    assert.throws(() => planCronosArm(600, 0, 0, 0, { armFundsUsd: 50, cronosQuote: "cro" }), /Need a CRO price/);
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
