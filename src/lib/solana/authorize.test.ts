import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planAuthorization, planProfitWithdrawal } from "./authorize";

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

describe("planProfitWithdrawal", () => {
  it("sends only the cash above the deposit", () => {
    const plan = planProfitWithdrawal({ usdc: 40, sol: 0.2, solPriceUsd: 100, principalUsd: 50 });
    assert.equal(plan.usdc, 10);
    assert.equal(plan.sol, 0);
    assert.equal(plan.profitUsd, 10);
  });

  it("keeps the deposit when there is no profit", () => {
    assert.throws(
      () => planProfitWithdrawal({ usdc: 25, sol: 0.2, solPriceUsd: 100, principalUsd: 45 }),
      /No trading profit/,
    );
  });

  it("uses SOL only after USDC and keeps a fee reserve", () => {
    const plan = planProfitWithdrawal({ usdc: 0, sol: 0.5, solPriceUsd: 100, principalUsd: 30 });
    assert.equal(plan.usdc, 0);
    assert.ok(Math.abs(plan.sol - 0.2) < 1e-9);
    assert.equal(plan.profitUsd, 20);
  });
});
