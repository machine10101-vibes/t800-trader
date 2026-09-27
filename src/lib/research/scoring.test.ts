import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TokenCandidate } from "../types";
import { bookScreen, scoreCandidate, screenCandidate } from "./scoring";

function token(over: Partial<TokenCandidate> = {}): TokenCandidate {
  const flow = { buys: 100, sells: 95, buyers: 80, sellers: 78, volumeUsd: 40_000, priceChangePct: 2 };
  return {
    id: "mint",
    chain: "solana",
    symbol: "JUP",
    name: "Jupiter",
    mint: "mint",
    poolAddress: "pool",
    dex: "raydium",
    quoteSymbol: "SOL",
    priceUsd: 0.5,
    marketCapUsd: 1_000_000_000,
    fdvUsd: 1_100_000_000,
    liquidityUsd: 2_000_000,
    volume24hUsd: 80_000_000,
    poolCreatedAt: new Date(Date.now() - 86400000 * 400).toISOString(),
    ageHours: 400 * 24,
    sector: "DEX",
    flows: {
      m5: { ...flow, volumeUsd: 2000 },
      m15: { ...flow, volumeUsd: 8000 },
      m30: { ...flow, volumeUsd: 16000 },
      h1: { ...flow, volumeUsd: 40_000 },
      h6: { ...flow, volumeUsd: 200_000 },
      h24: { ...flow, volumeUsd: 80_000_000, buys: 9000, sells: 8800, buyers: 4000, sellers: 3900 },
    },
    watchlist: true,
    sources: ["test"],
    ...over,
  };
}

const blankTech = {
  rsi14: 55,
  ema9: 1.02,
  ema21: 1.0,
  vwap: 1.01,
  atrPct: 1.4,
  volumeZ: 1.3,
  lastClose: 1.02,
  extensionPct: 1.0,
  closeStrength: 0.7,
  priorHigh: 1.0,
  priorLow: 0.96,
  barsAboveEma9: 3,
};

describe("screenCandidate", () => {
  it("rejects thin books", () => {
    const reason = screenCandidate(token({ liquidityUsd: 1000, watchlist: false }), {
      minLiquidityUsd: 120_000,
      minVolume24hUsd: 80_000,
      minAgeHours: 8,
      allowMemes: true,
    });
    assert.ok(reason?.includes("Liquidity"));
  });

  it("rejects wrapped majors", () => {
    const reason = screenCandidate(token({ symbol: "WETH", name: "Wrapped Ether", watchlist: false }), {
      minLiquidityUsd: 120_000,
      minVolume24hUsd: 80_000,
      minAgeHours: 8,
      allowMemes: true,
    });
    assert.ok(reason?.includes("Wrapped"));
  });

  it("rejects wrapped majors even if they were mis-tagged watchlist", () => {
    const reason = screenCandidate(token({ symbol: "ZEC", name: "Zcash", watchlist: true }), {
      minLiquidityUsd: 120_000,
      minVolume24hUsd: 80_000,
      minAgeHours: 8,
      allowMemes: true,
    });
    assert.ok(reason?.includes("Wrapped"));
  });

  it("rejects a pool on a venue the book turned off", () => {
    const reason = screenCandidate(token({ dex: "pumpswap", watchlist: false }), {
      minLiquidityUsd: 120_000,
      minVolume24hUsd: 80_000,
      minAgeHours: 8,
      allowMemes: true,
      venues: ["raydium", "orca"],
    });
    assert.equal(reason, "Venue Pump.fun is off");
  });

  it("keeps a Raydium CLMM pool when Raydium is on", () => {
    const reason = screenCandidate(token({ dex: "raydium-clmm" }), {
      minLiquidityUsd: 120_000,
      minVolume24hUsd: 80_000,
      minAgeHours: 8,
      allowMemes: true,
      venues: ["raydium"],
    });
    assert.equal(reason, null);
  });

  it("lets the Cronos book through on VVS even when the saved venues are Solana's", () => {
    const cro = token({ symbol: "CRO", name: "Cronos", dex: "vvs", chain: "cronos" });
    const saved = {
      minLiquidityUsd: 120_000,
      minVolume24hUsd: 80_000,
      minAgeHours: 8,
      allowMemes: true,
      venues: ["raydium", "orca", "meteora", "jupiter", "pump", "other"],
    };
    assert.equal(screenCandidate(cro, saved), "Venue VVS Finance is off");
    assert.equal(screenCandidate(cro, bookScreen(saved, "cronos")), null);
    assert.equal(screenCandidate(token({ dex: "vvs" }), bookScreen(saved, "solana")), "Venue VVS Finance is off");
  });

  it("passes liquid watchlist names", () => {
    const reason = screenCandidate(token(), {
      minLiquidityUsd: 120_000,
      minVolume24hUsd: 80_000,
      minAgeHours: 8,
      allowMemes: true,
    });
    assert.equal(reason, null);
  });
});

describe("scoreCandidate", () => {
  it("scores an established venue above a brand-new launchpad meme", () => {
    const good = scoreCandidate(token(), blankTech);
    const bad = scoreCandidate(
      token({
        symbol: "XYZ",
        name: "Mystery Inu",
        watchlist: false,
        sector: "Meme",
        dex: "pumpswap",
        ageHours: 2,
        liquidityUsd: 130_000,
        volume24hUsd: 2_000_000,
        marketCapUsd: 200_000,
        fdvUsd: 4_000_000,
        flows: token().flows,
      }),
      { ...blankTech, rsi14: 86, extensionPct: 12 },
    );
    assert.ok(good.researchScore > bad.researchScore);
    assert.ok(good.researchScore > 50);
  });

  it("lifts a sourced LST yield and marks a split price as a penalty", () => {
    const plain = scoreCandidate(token({ sector: "LST", symbol: "JITOSOL" }), blankTech);
    const yielded = scoreCandidate(
      token({
        sector: "LST",
        symbol: "JITOSOL",
        apyPct: 5,
        apySources: ["jito:stake-pool"],
        priceAgreement: "agree",
        sources: ["geckoterminal:price", "jupiter:price", "defillama:price"],
      }),
      blankTech,
    );
    const split = scoreCandidate(token({ priceAgreement: "split" }), blankTech);
    const aligned = scoreCandidate(token(), blankTech);
    const meme = scoreCandidate(token({ sector: "Meme", symbol: "BONK", name: "Bonk" }), blankTech);
    const memeYield = scoreCandidate(
      token({ sector: "Meme", symbol: "BONK", name: "Bonk", apyPct: 20, apySources: ["junk"] }),
      blankTech,
    );
    assert.ok(yielded.researchScore > plain.researchScore);
    assert.ok(yielded.strengths.some((n) => n.includes("Sourced yield")));
    assert.ok(split.researchScore < aligned.researchScore);
    assert.ok(split.penalties.some((n) => /disagree/i.test(n)));
    assert.equal(memeYield.researchScore, meme.researchScore);
  });
});
