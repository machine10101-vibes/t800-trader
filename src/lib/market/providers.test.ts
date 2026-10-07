import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ACTIVE_BOOK, bookMints, bookPools } from "./universe";
import { applyJupiterTape } from "./jupiterTape";
import { geckoIsCooling, skeletonBook } from "./providers";

describe("skeletonBook", () => {
  it("pins every Solana book mint so Jupiter can stamp a quiet tape", () => {
    const rows = skeletonBook("solana");
    assert.deepEqual(
      rows.map((row) => row.mint),
      [...ACTIVE_BOOK],
    );
    assert.equal(geckoIsCooling(), false);
    for (const row of rows) {
      const pin = bookPools("solana").find((item) => item.mint === row.mint)?.pool;
      assert.equal(row.poolAddress, pin);
      assert.equal(row.sources[0], "book");
      assert.equal(row.flows.m15.priceChangePct, 0);
      const stamped = applyJupiterTape(row, {
        priceUsd: 12,
        liquidityUsd: 200_000,
        volume24hUsd: 50_000,
        windows: {
          m15: { buys: 4, sells: 2, buyers: 3, sellers: 0, volumeUsd: 800, priceChangePct: 0.6 },
        },
      });
      assert.equal(stamped.priceUsd, 12);
      assert.equal(stamped.flows.m15.priceChangePct, 0.6);
      assert.equal(stamped.liquidityUsd, 200_000);
    }
  });

  it("pins the five Cronos names the desk trades", () => {
    const rows = skeletonBook("cronos");
    assert.deepEqual(
      rows.map((row) => row.symbol),
      ["CRO", "ULTCAT", "CRIMECAT", "MERY", "PACK"],
    );
    assert.deepEqual(
      rows.map((row) => row.mint),
      bookMints("cronos"),
    );
  });
});
