import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planAuthorization, planProfitWithdrawal, tradingKeyCoversSpend } from "./authorize";

describe("planAuthorization", () => {
  it("moves the chosen USDC size and only enough SOL for fees", () => {
    const plan = planAuthorization(0.2, 80, { armFundsUsd: 50 });
    assert.equal(plan.usdcToBot, 50);
    assert.ok(plan.solToBot >= 0.01);
    assert.ok(plan.solToBot <= 0.18);
  });

  it("tops up a trading key that is already partly funded", () => {
    const plan = planAuthorization(0.2, 40, { armFundsUsd: 50, alreadyUsdc: 20, alreadyNative: 0.02 });
    assert.equal(plan.usdcToBot, 30);
    assert.equal(plan.solToBot, 0);
  });

  it("refuses a wallet that cannot pay the swap fees or the chosen USDC size", () => {
    assert.throws(() => planAuthorization(0.01, 40, { armFundsUsd: 25 }), /0\.025 SOL/);
    assert.throws(() => planAuthorization(0.2, 10, { armFundsUsd: 50 }), /\$50 USDC/);
  });
});

describe("tradingKeyCoversSpend", () => {
  it("keeps a funded SOL balance in place", () => {
    assert.equal(tradingKeyCoversSpend({ sol: 0.13, usdc: 0, equityUsd: 15 }), true);
    assert.equal(tradingKeyCoversSpend({ sol: 0.13, usdc: 0, equityUsd: 0 }), true);
  });

  it("still needs a first funding transfer when the trading account is empty", () => {
    assert.equal(tradingKeyCoversSpend(null), false);
    assert.equal(tradingKeyCoversSpend({ sol: 0.005, usdc: 0, equityUsd: 0 }), false);
    assert.equal(tradingKeyCoversSpend({ sol: 0.02, usdc: 0, equityUsd: 0 }), false);
  });

  it("does not treat a few dollars of SOL as enough to open 5x or 10x", () => {
    assert.equal(tradingKeyCoversSpend({ sol: 0.05, usdc: 0, equityUsd: 6 }, 0.01, 10), false);
    assert.equal(tradingKeyCoversSpend({ sol: 0.13, usdc: 0, equityUsd: 15 }, 0.01, 10), true);
    assert.equal(tradingKeyCoversSpend({ sol: 0.13, usdc: 0, equityUsd: 0 }, 0.01, 10), true);
    assert.equal(tradingKeyCoversSpend({ sol: 0.02, usdc: 12, equityUsd: 14 }, 0.01, 10), true);
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
