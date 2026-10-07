import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { minOut, planCronosArm } from "./arm";

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

  it("refuses a wallet that cannot pay Cronos gas", () => {
    assert.throws(() => planCronosArm(0.4, 0), /3 CRO/);
  });

  it("haircuts a quoted swap by the slippage band", () => {
    assert.equal(minOut(10_000n, 80), 9_920n);
    assert.equal(minOut(0n), 0n);
  });
});
