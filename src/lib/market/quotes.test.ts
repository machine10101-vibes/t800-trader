import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TokenCandidate } from "../types";
import { JITO_SOL_MINT, JLP_MINT, SOL_MINT } from "./universe";
import { applyQuoteBlend, attachYields, blendQuotes, markIsTradable, normalizeRate } from "./quotes";

function row(over: Partial<TokenCandidate> = {}): TokenCandidate {
  return {
    id: "mint",
    chain: "solana",
    symbol: "SOL",
    name: "Solana",
    mint: SOL_MINT,
    poolAddress: "pool",
    dex: "raydium",
    quoteSymbol: "USDC",
    priceUsd: 100,
    marketCapUsd: null,
    fdvUsd: null,
    liquidityUsd: 1_000_000,
    volume24hUsd: 1_000_000,
    poolCreatedAt: null,
    ageHours: 1000,
    sector: "L1",
    flows: {
      m5: { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 0 },
      m15: { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 0 },
      m30: { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 0 },
      h1: { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 0 },
      h6: { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 0 },
      h24: { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 0 },
    },
    watchlist: true,
    sources: ["geckoterminal:trending"],
    ...over,
  };
}

describe("blendQuotes", () => {
  it("uses the median of agreeing feeds and drops an outlier", () => {
    const blended = blendQuotes([
      { source: "geckoterminal:price", price: 100 },
      { source: "jupiter:price", price: 101 },
      { source: "defillama:price", price: 99 },
      { source: "dexscreener:price", price: 140 },
    ]);
    assert.equal(blended.agreement, "agree");
    assert.ok(blended.price !== null && Math.abs(blended.price - 100) < 1);
    assert.equal(blended.sources.includes("dexscreener:price"), false);
    assert.equal(blended.sources.includes("jupiter:price"), true);
  });

  it("keeps the GeckoTerminal mark when two feeds split", () => {
    const blended = blendQuotes([
      { source: "geckoterminal:price", price: 100 },
      { source: "jupiter:price", price: 180 },
    ]);
    assert.equal(blended.agreement, "split");
    assert.equal(blended.price, 100);
    assert.equal(markIsTradable(blended.agreement), false);
  });

  it("does not invent a price when feeds split and GeckoTerminal is absent", () => {
    const blended = blendQuotes([
      { source: "jupiter:price", price: 10 },
      { source: "dexscreener:price", price: 40 },
    ]);
    assert.equal(blended.agreement, "split");
    assert.equal(blended.price, null);
    const applied = applyQuoteBlend(row({ priceUsd: 0, sources: [] }), [
      { source: "jupiter:price", price: 10 },
      { source: "dexscreener:price", price: 40 },
    ]);
    assert.equal(applied.priceUsd, 0);
    assert.equal(applied.priceAgreement, "split");
  });

  it("keeps a single feed without calling it agreement", () => {
    const blended = blendQuotes([{ source: "jupiter:price", price: 5 }]);
    assert.equal(blended.agreement, "thin");
    assert.equal(blended.price, 5);
    assert.equal(markIsTradable("thin"), true);
  });
});

describe("normalizeRate", () => {
  it("reads a fraction, a percent, and basis points", () => {
    assert.ok(Math.abs((normalizeRate(0.049822) ?? 0) - 4.9822) < 1e-6);
    assert.equal(normalizeRate(8.87), 8.87);
    assert.equal(normalizeRate(442), 4.42);
    assert.equal(normalizeRate(0), null);
    assert.equal(normalizeRate(9_000), null);
  });
});

describe("attachYields", () => {
  it("stamps JitoSOL and does not copy that yield onto SOL", () => {
    const rows = attachYields(
      [
        row({ mint: JITO_SOL_MINT, symbol: "JITOSOL", sector: "LST" }),
        row({ mint: SOL_MINT, symbol: "SOL", sector: "L1" }),
      ],
      [
        { mint: JITO_SOL_MINT, label: "JitoSOL", apyPct: 4.98, source: "jito:stake-pool" },
        { mint: SOL_MINT, label: "SOL", apyPct: 0, source: "sanctum" },
      ],
    );
    assert.equal(rows[0].apyPct, 4.98);
    assert.deepEqual(rows[0].apySources, ["jito:stake-pool"]);
    assert.equal(rows[1].apyPct, null);
  });

  it("uses the lower print when two APY feeds disagree", () => {
    const rows = attachYields(
      [row({ mint: JLP_MINT, symbol: "JLP", sector: "Perps" })],
      [
        { mint: JLP_MINT, label: "JLP", apyPct: 8.8, source: "jupiter:jlp" },
        { mint: JLP_MINT, label: "JLP", apyPct: 4, source: "other" },
      ],
    );
    assert.equal(rows[0].apyPct, 4);
    assert.deepEqual(rows[0].apySources, ["jupiter:jlp", "other"]);
  });

  it("averages feeds that sit close together", () => {
    const rows = attachYields(
      [row({ mint: JLP_MINT, symbol: "JLP", sector: "Perps" })],
      [
        { mint: JLP_MINT, label: "JLP", apyPct: 8.8, source: "jupiter:jlp" },
        { mint: JLP_MINT, label: "JLP", apyPct: 8.2, source: "other" },
      ],
    );
    assert.equal(rows[0].apyPct, 8.5);
    assert.equal(rows[0].apySources?.length, 2);
  });
});
