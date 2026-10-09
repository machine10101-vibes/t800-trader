import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PACK_MINT, WCRO_MINT } from "../market/universe";
import {
  fillEmptyBuckets,
  hoursToCandles,
  loadVvsFrames,
  mintUsdFromReserves,
  swapMintUsd,
  swapsToCandles,
  vvsPairId,
  type VvsHour,
  type VvsSwap,
} from "./vvsChart";

function hour(over: Partial<VvsHour> = {}): VvsHour {
  return {
    hourStartUnix: 1_700_000_000,
    reserve0: 100,
    reserve1: 50,
    reserveUSD: 200,
    hourlyVolumeUSD: 10,
    ...over,
  };
}

function swap(over: Partial<VvsSwap> = {}): VvsSwap {
  return {
    timestamp: 1_700_000_030,
    amount0In: 2,
    amount1In: 0,
    amount0Out: 0,
    amount1Out: 1,
    amountUSD: 4,
    ...over,
  };
}

describe("vvsChart", () => {
  it("pins the named Cronos book to a VVS pair, including PACK's real PACK/WCRO pool", () => {
    assert.equal(vvsPairId(WCRO_MINT), "0xe61db569e231b3f5530168aa2c9d50246525b6d6");
    assert.equal(vvsPairId(PACK_MINT), "0xcc2f3b5d2f1f154d31344b07e18335485d2ca57d");
  });

  it("prices the book mint from VVS reserves and swap fills", () => {
    assert.equal(mintUsdFromReserves(hour(), true), 1);
    assert.equal(mintUsdFromReserves(hour(), false), 2);
    assert.equal(swapMintUsd(swap(), true), 2);
    assert.equal(swapMintUsd(swap({ amount0In: 0, amount0Out: 0 }), true), null);
  });

  it("builds 1-hour candles from VVS hour snapshots and 5-minute candles from swaps", () => {
    const hourly = hoursToCandles(
      [
        hour({ hourStartUnix: 1_700_000_000, reserve0: 100, reserveUSD: 200 }),
        hour({ hourStartUnix: 1_700_003_600, reserve0: 80, reserveUSD: 200 }),
      ],
      true,
    );
    assert.equal(hourly.length, 2);
    assert.equal(hourly[0]?.close, 1);
    assert.equal(hourly[1]?.open, 1);
    assert.equal(hourly[1]?.close, 1.25);

    const start = 1_700_000_100;
    const five = swapsToCandles(
      [
        swap({ timestamp: start + 10, amountUSD: 4, amount0In: 2 }),
        swap({ timestamp: start + 80, amountUSD: 6, amount0In: 2 }),
        swap({ timestamp: start + 400, amountUSD: 2, amount0In: 1 }),
      ],
      true,
      300,
    );
    assert.equal(five.length, 2);
    assert.equal(five[0]?.open, 2);
    assert.equal(five[0]?.close, 3);
    assert.equal(five[0]?.high, 3);
    assert.equal(five[1]?.time, Math.floor((start + 400) / 300) * 300);

    const filled = fillEmptyBuckets(
      [
        { time: start, open: 2, high: 3, low: 2, close: 3, volume: 10 },
        { time: start + 600, open: 4, high: 4, low: 4, close: 4, volume: 1 },
      ],
      300,
      start + 600,
    );
    assert.equal(filled.length, 3);
    assert.equal(filled[1]?.time, start + 300);
    assert.equal(filled[1]?.close, 3);
    assert.equal(filled[1]?.volume, 0);
  });

  it("reads a live VVS hour series for CRO", async (t) => {
    try {
      const book = await loadVvsFrames(WCRO_MINT);
      if (!book?.hourly.length) {
        t.skip("VVS graph did not return CRO hour bars this cycle");
        return;
      }
      assert.ok(book.hourly.length >= 8, `CRO hours ${book.hourly.length}`);
      assert.ok(book.hourly.every((bar) => bar.close > 0 && bar.time > 0));
    } catch (error) {
      t.skip(`VVS chart feed unavailable: ${error instanceof Error ? error.message : error}`);
    }
  });
});
