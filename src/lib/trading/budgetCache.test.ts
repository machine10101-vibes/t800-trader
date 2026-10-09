import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BUDGET_FRESH_MS,
  budgetCacheKey,
  clearBudgetCache,
  freshBudget,
  recallBudget,
  rememberBudget,
} from "./budgetCache";

describe("budgetCache", () => {
  it("remembers a trading-key read so a later RPC miss can still spend", () => {
    clearBudgetCache();
    const held = rememberBudget("solana", "SoL11111111111111111111111111111111111111112", {
      usdc: 25,
      sol: 0.04,
      solPriceUsd: 180,
    });
    assert.equal(held.usdc, 25);
    assert.deepEqual(freshBudget("solana", "SoL11111111111111111111111111111111111111112"), held);
    assert.equal(budgetCacheKey("cronos", "0xABC"), "cronos:0xabc");
    assert.equal(recallBudget("cronos", "0xabc"), null);
  });

  it("keeps a stale read after the fresh window and drops it after the long window", () => {
    clearBudgetCache();
    rememberBudget("cronos", "0xabc", { usdc: 10, sol: 2, solPriceUsd: 0.1, wcro: 1 });
    const now = Date.now();
    const realNow = Date.now;
    Date.now = () => now + BUDGET_FRESH_MS + 1;
    try {
      assert.equal(freshBudget("cronos", "0xABC"), null);
      const stale = recallBudget("cronos", "0xABC");
      assert.equal(stale?.usdc, 10);
      assert.equal(stale?.wcro, 1);
      assert.equal(recallBudget("cronos", "0xABC", 1), null);
    } finally {
      Date.now = realNow;
      clearBudgetCache();
    }
  });
});
