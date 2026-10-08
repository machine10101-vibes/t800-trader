import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PUMP_MINT, SOL_MINT, WCRO_MINT, ZBCN_MINT } from "../market/universe";
import type { Position } from "../types";
import { collateralFor, collateralRoom, effectiveMultipliers, leveragedTicket, marginFill, multiplierFor, normalizeMultipliers, orderForPosition, pickMultiplier, signedOnChain, tradeLeverage } from "./leverage";

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

  it("levers SOL only and leaves every other name at spot", () => {
    assert.equal(multiplierFor([5, 10], 80, "breakout", "SOL", SOL_MINT), 10);
    assert.equal(multiplierFor([5, 10], 60, "reclaim", "SOL", SOL_MINT), 5);
    assert.equal(multiplierFor([5, 10], 80, "breakout", "ZBCN", ZBCN_MINT), 1);
    assert.equal(multiplierFor([5, 10], 60, "reclaim", "PUMP", PUMP_MINT), 1);
    assert.equal(multiplierFor([5, 10], 80, "breakout", "CRO", WCRO_MINT), 1);
    assert.equal(multiplierFor([5, 10], 90, "breakout", "JUP", "jup"), 1);
    assert.equal(multiplierFor([], 90, "breakout", "SOL", SOL_MINT), 1);
  });

  it("applies SOL margin only when the mode and 4-hour gate allow it", () => {
    assert.deepEqual(effectiveMultipliers("spot", [5, 10]), []);
    assert.deepEqual(effectiveMultipliers("margin", []), [5, 10]);
    assert.equal(
      tradeLeverage({ multipliers: [5, 10], confidence: 80, reason: "breakout", symbol: "SOL", mint: SOL_MINT, mode: "spot" }),
      1,
    );
    assert.equal(
      tradeLeverage({
        multipliers: [5, 10],
        confidence: 80,
        reason: "breakout",
        symbol: "SOL",
        mint: SOL_MINT,
        mode: "both",
        marginOnFourHour: true,
        setupFrame: "15m",
      }),
      1,
    );
    assert.equal(
      tradeLeverage({
        multipliers: [],
        confidence: 80,
        reason: "breakout",
        symbol: "SOL",
        mint: SOL_MINT,
        mode: "margin",
        marginOnFourHour: true,
        setupFrame: "4h",
      }),
      10,
    );
    assert.equal(
      tradeLeverage({
        multipliers: [5, 10],
        confidence: 80,
        reason: "breakout",
        symbol: "ZBCN",
        mint: ZBCN_MINT,
        mode: "margin",
        setupFrame: "4h",
      }),
      1,
    );
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

  it("posts a $5 order at 5x or 10x and stays spot below that", () => {
    assert.deepEqual(collateralFor(5, 15, 5), { leverage: 5, collateralUsd: 5, spotFallback: false });
    assert.deepEqual(collateralFor(5, 40, 10), { leverage: 10, collateralUsd: 5, spotFallback: false });
    assert.deepEqual(collateralFor(6, 15, 5), { leverage: 5, collateralUsd: 6, spotFallback: false });
    assert.deepEqual(collateralFor(12, 14, 10), { leverage: 10, collateralUsd: 12, spotFallback: false });
    assert.deepEqual(collateralFor(3, 20, 5), { leverage: 5, collateralUsd: 5, spotFallback: false });
    const small = collateralFor(3, 3.5, 5);
    assert.equal(small.leverage, 1);
    assert.equal(small.spotFallback, true);
    assert.ok(small.collateralUsd <= 3.5);
  });

  it("keeps 5x and 10x when the cash cap would have left the room under $5", () => {
    assert.equal(collateralRoom(15, 0.35, 1), 15 * 0.35);
    assert.equal(collateralRoom(15, 0.35, 5), 15);
    assert.equal(collateralRoom(5, 0.92, 5), 5);
    assert.ok(collateralRoom(4, 0.92, 5) < 5);
    const five = leveragedTicket(5, 15, 0.35, 5);
    assert.equal(five.leverage, 5);
    assert.equal(five.spotFallback, false);
    assert.equal(five.collateralUsd, 5);
    const ten = leveragedTicket(5, 15, 0.92, 10);
    assert.equal(ten.leverage, 10);
    assert.equal(ten.spotFallback, false);
    assert.equal(ten.collateralUsd, 5);
    const spot = leveragedTicket(6, 4, 0.92, 5);
    assert.equal(spot.leverage, 1);
    assert.equal(spot.spotFallback, true);
  });

  it("closes a SOL 5x or 10x by the marked exposure and a spot bag by the collateral", () => {
    const solLong = orderForPosition(ticket({ mint: SOL_MINT, symbol: "SOL", qty: 0.5, markPrice: 200, leverage: 5, side: "long" }), "close");
    assert.equal(solLong.qty, 0.5);
    assert.equal(solLong.notionalUsd, 100);
    assert.equal(solLong.leverage, 5);
    assert.equal(solLong.side, "long");
    const solShort = orderForPosition(
      ticket({ mint: SOL_MINT, symbol: "SOL", qty: 1, markPrice: 200, leverage: 10, side: "short", positionPubkey: "pos" }),
      "scale",
      undefined,
      0.5,
    );
    assert.equal(solShort.side, "short");
    assert.equal(solShort.qty, 0.5);
    assert.equal(solShort.notionalUsd, 100);
    assert.equal(solShort.leverage, 10);
    assert.equal(solShort.positionPubkey, "pos");
    const bag = orderForPosition(ticket({ qty: 5000, markPrice: 0.002, leverage: 5 }), "close");
    assert.equal(bag.qty, 1000);
    assert.ok(Math.abs(bag.notionalUsd - 2) < 1e-9);
    const scaledBag = orderForPosition(ticket({ qty: 10000, markPrice: 0.002, leverage: 10 }), "scale", undefined, 0.5);
    assert.equal(scaledBag.qty, 500);
    assert.equal(signedOnChain(ticket({ signature: "sig", side: "short", leverage: 10 })), true);
    assert.equal(signedOnChain(ticket({ signature: "sig", side: "short", leverage: 1 })), false);
    assert.equal(signedOnChain(ticket({ signature: "sig", side: "long" })), true);
    assert.equal(signedOnChain(ticket({ signature: "", side: "short", leverage: 10 })), false);
  });
});

function ticket(over: Partial<Position> = {}): Position {
  return {
    id: "p",
    mint: ZBCN_MINT,
    symbol: "ZBCN",
    poolAddress: "pool",
    sector: "Payments",
    side: "long",
    qty: 1,
    entryPrice: 1,
    markPrice: 1,
    stopPrice: 0.98,
    targetPrice: 1.04,
    openedAt: new Date().toISOString(),
    lastUpdate: new Date().toISOString(),
    reason: "reclaim",
    researchScore: 70,
    highWater: 1,
    lowWater: 1,
    notional: 1,
    initialStop: 0.98,
    scaled: false,
    signature: "sig",
    ...over,
  };
}
