import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { multiplierFor } from "../trading/leverage";
import { selectPopular } from "./jupiterPopular";
import { headlineFor, isActiveBook, notePopular, SOL_MINT, ZBCN_MINT } from "./universe";

const PUMP = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";

describe("Jupiter popular tokens", () => {
  it("keeps liquid most-traded names and drops stables, dust, and the pinned book", () => {
    const rows = [
      { id: SOL_MINT, symbol: "SOL", name: "Solana", liquidity: 50_000_000, organicScore: 99 },
      { id: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", liquidity: 80_000_000, organicScore: 99 },
      {
        id: PUMP,
        symbol: "PUMP",
        name: "Pump",
        liquidity: 37_000_000,
        organicScore: 98,
        usdPrice: 0.0042,
        graduatedPool: "5DKFn27xzpiWQBoauSkWsw115SyMFFkbDNVHDGSXNHJ5",
        stats5m: { priceChange: 1.25 },
      },
      { id: "dust", symbol: "MIGR", name: "Migr", liquidity: 13_000, organicScore: 70 },
      { id: "thin", symbol: "manifest", name: "manifest", liquidity: 200_000, organicScore: 40 },
      { id: "KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS", symbol: "KMNO", name: "Kamino", liquidity: 2_900_000, organicScore: 90 },
      { id: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", symbol: "cbBTC", name: "Coinbase Wrapped BTC", liquidity: 30_000_000, organicScore: 92 },
      { id: ZBCN_MINT, symbol: "ZBCN", name: "Zebec", liquidity: 5_000_000, organicScore: 80 },
      { id: "paid", symbol: "PAID", name: "Paid", liquidity: 2_600_000, organicScore: 93 },
      { id: "stonk", symbol: "STONK", name: "STONK", liquidity: 6_900_000, organicScore: 96 },
      { id: "extra", symbol: "EXTRA", name: "Extra", liquidity: 1_000_000, organicScore: 80 },
    ];
    const picked = selectPopular(rows);
    assert.deepEqual(
      picked.map((token) => token.symbol),
      ["PUMP", "KMNO", "CBBTC", "PAID", "STONK", "EXTRA"],
    );
    assert.equal(picked.find((token) => token.symbol === "KMNO")?.sector, "Lending");
    const pump = picked.find((token) => token.symbol === "PUMP");
    assert.equal(pump?.priceUsd, 0.0042);
    assert.equal(pump?.pool, "5DKFn27xzpiWQBoauSkWsw115SyMFFkbDNVHDGSXNHJ5");
    assert.equal(pump?.change5m, 1.25);
  });

  it("does not add Jupiter's most-traded list to the book", () => {
    try {
      notePopular([{ symbol: "KMNO", name: "Kamino", mint: "KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS", sector: "Lending" }]);
      assert.equal(isActiveBook("KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS"), false);
      assert.deepEqual(
        headlineFor().map((row) => row.symbol),
        ["SOL", "ZBCN", "PUMP", "ZEC", "RAY"],
      );
      assert.equal(isActiveBook(PUMP), true);
      assert.equal(isActiveBook(PUMP, "cronos"), false);
      assert.equal(multiplierFor([5, 10], 60, "reclaim", "PUMP", PUMP), 5);
      assert.equal(multiplierFor([5, 10], 80, "breakout", "PUMP", PUMP), 10);
      assert.equal(multiplierFor([5, 10], 90, "breakout", "JUP", "jup"), 1);
    } finally {
      notePopular([]);
    }
    assert.equal(isActiveBook(PUMP), true);
  });
});
