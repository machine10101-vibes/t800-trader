import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bookTokens } from "../market/universe";
import { scoreCandidate } from "./scoring";
import { keepNamedScores } from "./engine";
import type { ScoredCandidate, TokenCandidate } from "../types";

function scored(over: Partial<TokenCandidate>): ScoredCandidate {
  const flow = { buys: 10, sells: 9, buyers: 8, sellers: 7, volumeUsd: 1_000, priceChangePct: 0.4 };
  const row: TokenCandidate = {
    id: over.mint ?? "mint",
    chain: "cronos",
    symbol: "COIN",
    name: "Coin",
    mint: "0x1",
    poolAddress: "pool",
    dex: "vvs",
    quoteSymbol: "WCRO",
    priceUsd: 0.01,
    marketCapUsd: 100_000,
    fdvUsd: 100_000,
    liquidityUsd: 20_000,
    volume24hUsd: 8_000,
    poolCreatedAt: null,
    ageHours: 1_000,
    sector: "Meme",
    flows: { m5: flow, m15: flow, m30: flow, h1: flow, h6: flow, h24: flow },
    watchlist: true,
    sources: ["test"],
    ...over,
  };
  return scoreCandidate(row, {
    rsi14: 50,
    ema9: 1,
    ema21: 1,
    vwap: 1,
    atrPct: 1,
    volumeZ: 1,
    lastClose: 1,
    extensionPct: 0,
    closeStrength: 0.5,
    priorHigh: 1,
    priorLow: 1,
    barsAboveEma9: 1,
  });
}

describe("keepNamedScores", () => {
  it("puts every Cronos book name back on the Coins tab after the finalist cap", () => {
    const book = bookTokens("cronos").map((token) =>
      scored({ mint: token.mint, symbol: token.symbol, name: token.name, sector: token.sector }),
    );
    const kept = keepNamedScores(book, book.slice(0, 1), "cronos");
    assert.deepEqual(
      kept.map((row) => row.symbol),
      ["CRO", "ULTCAT", "CRIMECAT", "MERY", "PACK", "ULTI"],
    );
    for (const row of kept) assert.ok(row.researchScore > 0);
  });
});
