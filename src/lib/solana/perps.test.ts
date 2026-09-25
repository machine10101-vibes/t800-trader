import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SOL_MINT, ZBCN_MINT } from "../market/universe";
import type { ChainOrder } from "../types";
import { fillFromIncrease, perpUsd, planPerpDecrease, planPerpIncrease } from "./perps";

function order(over: Partial<ChainOrder> = {}): ChainOrder {
  return {
    kind: "open",
    side: "long",
    mint: SOL_MINT,
    symbol: "SOL",
    notionalUsd: 50,
    qty: 0.25,
    price: 200,
    leverage: 5,
    collateralUsd: 10,
    ...over,
  };
}

describe("perp planner", () => {
  it("reads Jupiter 1e6 dollar fields", () => {
    assert.equal(perpUsd("10000000"), 10);
    assert.equal(perpUsd("200.5"), 200.5);
  });

  it("spends SOL collateral for a 5x long and USDC when that covers the margin", () => {
    const sol = planPerpIncrease({ ...order(), usdc: 0, sol: 0.2, solPriceUsd: 200 });
    assert.equal(sol.leverage, "5");
    assert.equal(sol.inputToken, "SOL");
    assert.equal(sol.inputTokenAmount, "50000000");
    const usdc = planPerpIncrease({ ...order({ leverage: 10, collateralUsd: 10, notionalUsd: 100 }), usdc: 12, sol: 0.02, solPriceUsd: 200 });
    assert.equal(usdc.leverage, "10");
    assert.equal(usdc.inputToken, "USDC");
    assert.equal(usdc.inputTokenAmount, "10000000");
  });

  it("refuses a sub-$10 margin, a short, and Zebec", () => {
    assert.throws(() => planPerpIncrease({ ...order({ collateralUsd: 3, notionalUsd: 15 }), usdc: 0, sol: 1, solPriceUsd: 200 }), /\$10/);
    assert.throws(() => planPerpIncrease({ ...order({ side: "short" }), usdc: 20, sol: 1, solPriceUsd: 200 }), /Shorts/);
    assert.throws(
      () => planPerpIncrease({ ...order({ symbol: "ZBCN", mint: ZBCN_MINT }), usdc: 20, sol: 1, solPriceUsd: 200 }),
      /Zebec/,
    );
  });

  it("closes the whole position and scales a slice in raw dollars", () => {
    const close = planPerpDecrease(order({ kind: "close", positionPubkey: "pos" }));
    assert.equal(close.entirePosition, true);
    assert.equal(close.sizeUsdDelta, undefined);
    const scale = planPerpDecrease(order({ kind: "scale", positionPubkey: "pos", notionalUsd: 25 }));
    assert.equal(scale.entirePosition, false);
    assert.equal(scale.sizeUsdDelta, "25000000");
  });

  it("turns an increase quote into exposure, margin, and a position account", () => {
    const fill = fillFromIncrease(
      { averagePriceUsd: "200000000", collateralUsdDelta: "10000000", sizeUsdDelta: "50000000", leverage: "5" },
      "pos",
      "sig",
    );
    assert.equal(fill.price, 200);
    assert.equal(fill.collateralUsd, 10);
    assert.equal(fill.qty, 0.25);
    assert.equal(fill.leverage, 5);
    assert.equal(fill.positionPubkey, "pos");
    assert.equal(fill.signature, "sig");
  });
});
