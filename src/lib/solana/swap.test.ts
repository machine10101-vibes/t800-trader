import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SOL_MINT, USDC_MINT } from "../market/universe";
import { DEFAULT_VENUES } from "../market/venues";
import { baseUnits, planSpotOrder, sellQty } from "./swap";
import { dexesForVenues } from "../market/venues";

const order = {
  kind: "open" as const,
  side: "long" as const,
  mint: "mint",
  symbol: "JUP",
  notionalUsd: 10,
  qty: 20,
  price: 0.5,
  usdc: 25,
  sol: 0.2,
  solPriceUsd: 100,
  venues: [...DEFAULT_VENUES],
};

describe("sellQty", () => {
  it("sells the position size when the key holds more, and never more than the balance", () => {
    assert.equal(sellQty(1, 2), 1);
    assert.ok(Math.abs(sellQty(2, 1) - 0.9999) < 1e-12);
    assert.equal(sellQty(1, 0), 0);
  });
});

describe("baseUnits", () => {
  it("converts a decimal amount without floating dust", () => {
    assert.equal(baseUnits(1.25, 6), "1250000");
    assert.equal(baseUnits(0.01, 9), "10000000");
  });
});

describe("dexesForVenues", () => {
  it("lets Jupiter pick the route when every venue is on", () => {
    assert.equal(dexesForVenues(DEFAULT_VENUES), null);
    assert.equal(dexesForVenues(undefined), null);
  });

  it("restricts the route to the platforms still on", () => {
    const dexes = dexesForVenues(["raydium"]);
    assert.ok(dexes?.includes("Raydium"));
    assert.ok(dexes?.includes("Raydium CLMM"));
    assert.equal(dexes?.includes("Whirlpool"), false);
  });
});

describe("planSpotOrder", () => {
  it("spends USDC when the wallet covers the ticket", () => {
    const plan = planSpotOrder(order);
    assert.equal(plan.inputMint, USDC_MINT);
    assert.equal(plan.outputMint, "mint");
    assert.equal(plan.amount, "10000000");
  });

  it("spends SOL when USDC is short and leaves a fee reserve", () => {
    const plan = planSpotOrder({ ...order, usdc: 1, notionalUsd: 10, sol: 0.5, solPriceUsd: 100 });
    assert.equal(plan.inputMint, SOL_MINT);
    assert.equal(plan.amount, "100000000");
  });

  it("refuses a short and a wallet that cannot pay the fee", () => {
    assert.throws(() => planSpotOrder({ ...order, side: "short" }), /Shorts/);
    assert.throws(() => planSpotOrder({ ...order, sol: 0.001 }), /0\.005 SOL/);
    assert.throws(() => planSpotOrder({ ...order, usdc: 0, sol: 0.05, notionalUsd: 20, solPriceUsd: 100 }), /does not cover|needs about/);
  });

  it("sells the ticket quantity back to USDC", () => {
    const plan = planSpotOrder({ ...order, kind: "close", tokenDecimals: 6, qty: 1.5, usdc: 0 });
    assert.equal(plan.inputMint, "mint");
    assert.equal(plan.outputMint, USDC_MINT);
    assert.equal(plan.amount, "1500000");
  });
});
