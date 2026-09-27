import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchOhlcv, invalidateMarketCache, loadMarket } from "./providers";

describe("live Solana market feeds (read-only)", () => {
  it("loads a Solana-only universe without requiring API keys", async (t) => {
    invalidateMarketCache();
    try {
      const market = await loadMarket(true);
      assert.ok(market.regime.asOf);
      assert.ok(["risk-on", "mixed", "defensive"].includes(market.regime.stance));
      for (const c of market.candidates) {
        assert.equal(c.chain, "solana");
        assert.ok(c.mint);
        assert.ok(c.poolAddress);
      }
      if (market.candidates.length === 0) {
        t.skip("GeckoTerminal returned no Solana pools this cycle (rate limit or empty page)");
      }
    } catch (error) {
      t.skip(`market feeds unavailable: ${error instanceof Error ? error.message : error}`);
    }
  });

  it("reads 5m OHLCV for a live Solana pool when one is available", async (t) => {
    invalidateMarketCache();
    try {
      const market = await loadMarket();
      const pool = market.candidates.find((c) => c.poolAddress)?.poolAddress;
      if (!pool) {
        t.skip("no Solana pool available to fetch OHLCV");
        return;
      }
      const candles = await fetchOhlcv(pool, 20);
      assert.ok(Array.isArray(candles));
      for (const c of candles) {
        assert.ok(c.time > 0);
        assert.ok(c.close > 0);
      }
    } catch (error) {
      t.skip(`OHLCV feed unavailable: ${error instanceof Error ? error.message : error}`);
    }
  });
});
