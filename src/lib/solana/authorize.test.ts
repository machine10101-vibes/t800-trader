import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planAuthorization } from "./authorize";

describe("planAuthorization", () => {
  it("moves USDC and spare SOL, and leaves a fee reserve in the wallet", () => {
    const plan = planAuthorization(0.2, 25);
    assert.equal(plan.usdcToBot, 25);
    assert.ok(Math.abs(plan.solToBot - 0.18) < 1e-9);
  });

  it("can arm from SOL alone", () => {
    const plan = planAuthorization(0.5, 0);
    assert.equal(plan.usdcToBot, 0);
    assert.ok(Math.abs(plan.solToBot - 0.48) < 1e-9);
  });

  it("refuses a wallet that cannot pay the swap fees", () => {
    assert.throws(() => planAuthorization(0.01, 40), /0\.025 SOL/);
    assert.throws(() => planAuthorization(0.03, 0), /0\.04 SOL/);
  });
});
