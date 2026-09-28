import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TokenCandidate } from "@/lib/types";
import { applyJupiterTape, moveFromCloses, windowIsQuiet, type JupiterTape } from "./jupiterTape";

function window(priceChangePct: number, buys = 0, sells = 0, volumeUsd = 0) {
  return { buys, sells, buyers: 0, sellers: 0, volumeUsd, priceChangePct };
}

function token(): TokenCandidate {
  return {
    id: "mint",
    chain: "solana",
    symbol: "ZEC",
    name: "Zcash",
    mint: "mint",
    poolAddress: "pool",
    dex: "raydium",
    quoteSymbol: "USDC",
    priceUsd: 560,
    marketCapUsd: null,
    fdvUsd: null,
    liquidityUsd: 10,
    volume24hUsd: 0,
    poolCreatedAt: null,
    ageHours: 100,
    sector: "Payments",
    flows: {
      m5: window(0),
      m15: window(0.4, 10, 8, 1000),
      m30: window(0),
      h1: window(0),
      h6: window(0),
      h24: window(0),
    },
    watchlist: true,
    sources: [],
    priceAgreement: "thin",
    apyPct: null,
    apySources: [],
  };
}

describe("Jupiter tape", () => {
  it("fills a silent window and leaves a live pool print alone", () => {
    assert.equal(windowIsQuiet(window(0)), true);
    assert.equal(windowIsQuiet(window(0.4, 10, 8, 1000)), false);
    const tape: JupiterTape = {
      priceUsd: 1555,
      liquidityUsd: 5_000_000,
      volume24hUsd: 6_000_000,
      windows: {
        m5: window(-0.2, 30, 20, 4000),
        m15: window(-9, 1, 1, 1),
      },
    };
    const next = applyJupiterTape(token(), tape);
    assert.equal(next.flows.m5.priceChangePct, -0.2);
    assert.equal(next.flows.m5.buys, 30);
    assert.equal(next.flows.m15.priceChangePct, 0.4);
    assert.equal(next.liquidityUsd, 5_000_000);
    assert.equal(next.priceUsd, 1555);
    assert.equal(moveFromCloses(100, 90), -10);
  });
});