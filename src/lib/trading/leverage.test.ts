import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SOL_MINT, ZBCN_MINT } from "../market/universe";
import { collateralFor, marginFill, multiplierFor, normalizeMultipliers, pickMultiplier } from "./leverage";

describe("multipliers", () => {
  it("keeps 5x and 10x and drops anything else", () => {
    assert.deepEqual(normalizeMultipliers(undefined), [5, 10]);
    assert.deepEqual(normalizeMultipliers([]), []);
    assert.deepEqual(normalizeMultipliers([10, 1, 5, 5]), [5, 10]);
  });

  it("uses 10x on a strong tape and 5x otherwise", () => {
    assert.equal(pickMultiplier([5, 10], 80, "reclaim"), 10);
    assert.equal(pickMultiplier([5, 10], 60, "breakout"), 10);
    assert.equal(pickMultiplier([5, 10], 64, "reclaim"), 5);
    assert.equal(pickMultiplier([10], 60, "reclaim"), 10);
    assert.equal(pickMultiplier([], 90, "breakout"), null);
  });

  it("levers Solana and Zebec, and leaves every other name at spot", () => {
    assert.equal(multiplierFor([5, 10], 80, "breakout", "SOL", SOL_MINT), 10);
    assert.equal(multiplierFor([5, 10], 60, "reclaim", "ZBCN", ZBCN_MINT), 5);
    assert.equal(multiplierFor([5, 10], 80, "breakout", "ZBCN", ZBCN_MINT), 10);
    assert.equal(multiplierFor([5, 10], 90, "breakout", "JUP", "jup"), 1);
    assert.equal(multiplierFor([], 90, "breakout", "SOL", SOL_MINT), 1);
  });

  it("marks a Zebec spot bag at the full 5x or 10x exposure", () => {
    const five = marginFill({ signature: "sig", qty: 1000, price: 0.002, tokenDecimals: 6 }, 5, 10);
    assert.equal(five.qty, 5000);
    assert.equal(five.leverage, 5);
    assert.equal(five.collateralUsd, 10);
    const ten = marginFill({ signature: "sig", qty: 1000, price: 0.002, tokenDecimals: 6 }, 10, 12);
    assert.equal(ten.qty, 10000);
    assert.equal(ten.leverage, 10);
  });

  it("posts at least $10 when the wallet can, and stays spot below that", () => {
    assert.deepEqual(collateralFor(6, 15, 5), { leverage: 5, collateralUsd: 10, spotFallback: false });
    assert.deepEqual(collateralFor(12, 14, 10), { leverage: 10, collateralUsd: 12, spotFallback: false });
    const small = collateralFor(3, 3.5, 5);
    assert.equal(small.leverage, 1);
    assert.equal(small.spotFallback, true);
    assert.ok(small.collateralUsd <= 3.5);
  });
});
