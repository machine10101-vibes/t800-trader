import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SOL_MINT, USDC_MINT, ZBCN_MINT } from "../market/universe";
import { LIMIT_MIN_USD, makerBid, planMakerBuy, readTriggerOrder, shouldReplace } from "./quote";

describe("maker quotes", () => {
  it("bids inside the mid and replaces only after the mid moves", () => {
    const mid = 100;
    const bid = makerBid(mid);
    assert.ok(bid < mid);
    assert.ok(bid > mid * 0.998);
    assert.equal(shouldReplace(bid, mid), false);
    assert.equal(shouldReplace(bid, mid * 1.01), true);
  });

  it("spends SOL for a Zebec bid and USDC for a Solana bid", () => {
    const zebec = planMakerBuy({
      mint: ZBCN_MINT,
      mid: 0.002,
      notionalUsd: 6,
      usdc: 0,
      sol: 0.1,
      solPriceUsd: 200,
      outputDecimals: 6,
    });
    assert.equal(zebec.inputMint, SOL_MINT);
    assert.equal(zebec.outputMint, ZBCN_MINT);
    assert.equal(zebec.makingAmount, "30000000");
    assert.ok(Number(zebec.takingAmount) > 6 / 0.002 * 1e6);
    const sol = planMakerBuy({
      mint: SOL_MINT,
      mid: 200,
      notionalUsd: 6,
      usdc: 8,
      sol: 0.02,
      solPriceUsd: 200,
      outputDecimals: 9,
    });
    assert.equal(sol.inputMint, USDC_MINT);
    assert.equal(sol.makingAmount, "6000000");
  });

  it("refuses a bid under the Jupiter minimum", () => {
    assert.throws(
      () => planMakerBuy({ mint: ZBCN_MINT, mid: 0.002, notionalUsd: 3, usdc: 0, sol: 1, solPriceUsd: 200, outputDecimals: 6 }),
      new RegExp(String(LIMIT_MIN_USD)),
    );
  });

  it("books a fill signature and ignores a still-open order", () => {
    assert.equal(readTriggerOrder({ status: "Open" }, 1, 6), "open");
    assert.equal(readTriggerOrder({ status: "Cancelled" }, 1, 6), "gone");
    const fill = readTriggerOrder(
      { status: "Completed", trades: [{ action: "Fill", txId: "sig", rawOutputAmount: "2500000" }] },
      0.002,
      6,
    );
    assert.equal(typeof fill === "string" ? fill : fill.signature, "sig");
    assert.equal(typeof fill === "string" ? 0 : fill.qty, 2.5);
  });
});
