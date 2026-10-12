import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DASH_TOKEN, NEAR_USDT, intentAsset } from "./constants";
import { dashAccountFrom, parseNearAccount } from "./wallet";
import { nearDexQuoteBody, smallestUnits, swapPair, unitsToAmount } from "./quote";

describe("Dash NEAR DEX quote", () => {
  it("turns a coin amount into the token's smallest unit", () => {
    assert.equal(smallestUnits(1.5, 8), "150000000");
    assert.equal(smallestUnits(2, 6), "2000000");
    assert.equal(unitsToAmount("150000000", 8), 1.5);
    assert.equal(intentAsset(DASH_TOKEN), `nep141:${DASH_TOKEN}`);
  });

  it("buys with the spend coin and sells back to it", () => {
    assert.deepEqual(swapPair({ kind: "open", mint: "wrap.near", spend: "usdt" }), {
      tokenIn: NEAR_USDT,
      tokenOut: "wrap.near",
    });
    assert.deepEqual(swapPair({ kind: "close", mint: "wrap.near", spend: "dash" }), {
      tokenIn: "wrap.near",
      tokenOut: DASH_TOKEN,
    });
  });

  it("asks NEAR DEX for an exact-input deposit on the connected account", () => {
    const body = nearDexQuoteBody({
      tokenIn: NEAR_USDT,
      tokenOut: DASH_TOKEN,
      amountIn: 25,
      accountId: "desk.near",
      slippageBps: 80,
      now: Date.parse("2026-10-12T00:00:00.000Z"),
    });
    assert.equal(body.originAsset, `nep141:${NEAR_USDT}`);
    assert.equal(body.destinationAsset, `nep141:${DASH_TOKEN}`);
    assert.equal(body.amount, "25000000");
    assert.equal(body.recipient, "desk.near");
    assert.equal(body.slippageTolerance, 80);
    assert.equal(body.depositType, "ORIGIN_CHAIN");
  });

  it("reads a DashPay identity from the extension payload", () => {
    assert.equal(dashAccountFrom({ currentIdentity: "alice" }), "alice");
    assert.equal(dashAccountFrom({ identities: [{ address: "bob" }] }), "bob");
    assert.equal(dashAccountFrom(null), null);
    assert.equal(parseNearAccount("Desk.NEAR"), "desk.near");
    assert.equal(parseNearAccount("not an account"), null);
  });
});
