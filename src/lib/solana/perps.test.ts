import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SOL_MINT, ZBCN_MINT } from "../market/universe";
import type { ChainOrder } from "../types";
import { fillFromIncrease, perpUsd, planPerpDecrease, planPerpIncrease, quotedMultiplier } from "./perps";

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
    assert.equal(sol.priorityFeeMicroLamports, "250000");
    assert.equal(sol.inputToken, "SOL");
    assert.equal(sol.inputTokenAmount, "62500000");
    assert.equal(sol.sizeUsdDelta, "62500000");
    assert.ok(sol.collateralUsd >= 12);
    const usdc = planPerpIncrease({ ...order({ leverage: 10, collateralUsd: 10, notionalUsd: 100 }), usdc: 12, sol: 0.02, solPriceUsd: 200 });
    assert.equal(usdc.leverage, "10");
    assert.equal(usdc.inputToken, "USDC");
    assert.equal(usdc.inputTokenAmount, "12000000");
    assert.equal(usdc.sizeUsdDelta, "120000000");
  });

  it("posts $11 of USDC when the ask is higher and SOL cannot clear $10", () => {
    const plan = planPerpIncrease({
      ...order({ leverage: 5, collateralUsd: 14, notionalUsd: 70 }),
      usdc: 11,
      sol: 0.02,
      solPriceUsd: 200,
    });
    assert.equal(plan.inputToken, "USDC");
    assert.equal(plan.leverage, "5");
    assert.equal(plan.inputTokenAmount, "11000000");
    assert.equal(plan.sizeUsdDelta, "55000000");
    assert.ok(plan.collateralUsd >= 10);
  });

  it("posts SOL that clears $10 after the fee when the rent reserve would hide it", () => {
    const tight = planPerpIncrease({ ...order({ collateralUsd: 10 }), usdc: 0, sol: 0.1, solPriceUsd: 120 });
    assert.equal(tight.inputToken, "SOL");
    assert.equal(tight.leverage, "5");
    assert.equal(tight.inputTokenAmount, "88000000");
    assert.ok(tight.collateralUsd >= 10);
    const feeOnly = planPerpIncrease({ ...order({ collateralUsd: 10 }), usdc: 0, sol: 0.09, solPriceUsd: 120 });
    assert.equal(feeOnly.inputToken, "SOL");
    assert.equal(feeOnly.inputTokenAmount, "86000000");
    assert.ok(feeOnly.collateralUsd + 1e-9 >= 10);
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

  it("accepts a 5x or 10x quote and refuses an explicit 1x before signing", () => {
    assert.equal(quotedMultiplier({ leverage: "5" }, 5), 5);
    assert.equal(quotedMultiplier({ leverage: "10", collateralUsdDelta: "10000000", sizeUsdDelta: "100000000" }, 10), 10);
    assert.equal(quotedMultiplier({ collateralUsdDelta: "12500000", sizeUsdDelta: "62500000" }, 10), 5);
    assert.equal(
      quotedMultiplier({ leverage: "10", collateralUsdDelta: "10000000", sizeUsdDelta: "50000000" }, 10),
      5,
    );
    assert.equal(quotedMultiplier({}, 10), 10);
    assert.throws(
      () => quotedMultiplier({ leverage: "1", collateralUsdDelta: "10000000", sizeUsdDelta: "10000000" }, 5),
      /quoted this long at 1x/,
    );
    assert.throws(
      () => fillFromIncrease({ averagePriceUsd: "200000000", collateralUsdDelta: "10000000", sizeUsdDelta: "10000000", leverage: "1" }, "pos", "sig"),
      /quoted this long at 1x/,
    );
  });
});
