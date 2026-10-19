import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { majorsPerformancePct, paintRegime, quietRedMarket, tapeStance, type RegimeMark } from "./regime";

const mark = (price: number, change24h = 1): RegimeMark => ({
  price,
  change24h,
  marketCap: 0,
  volume24h: 0,
});

describe("paintRegime", () => {
  it("keeps Solana copy on the Sol desk", () => {
    const board = paintRegime({
      chain: "solana",
      btc: mark(70_000, 1),
      eth: mark(3_500, 0.5),
      l1: mark(180, 2),
      btcDom: 55,
      fear: { value: 50, label: "Neutral" },
      tvl: 8e9,
      dexVolume24h: 1.2e9,
      dexChange1d: 3,
    });
    assert.match(board.overview, /SOL \$180\.00/);
    assert.match(board.overview, /Solana DeFi TVL/);
    assert.match(board.overview, /Solana DEX volume/);
    assert.ok(board.overlooked.some((line) => line.includes("Solana names") || line.includes("Spot DEX")));
    assert.ok(board.overview.includes("SOL") && board.overview.includes("Solana"));
  });

  it("writes only Cronos tape on the CRO desk", () => {
    const board = paintRegime({
      chain: "cronos",
      btc: mark(70_000, 1),
      eth: mark(3_500, 0.5),
      l1: mark(0.12, 4),
      btcDom: 55,
      fear: { value: 50, label: "Neutral" },
      tvl: 1.1e9,
      dexVolume24h: 4e7,
      dexChange1d: 18,
    });
    const text = [board.overview, ...board.crowded, ...board.overlooked, ...board.narratives, board.stanceWhy].join(" ");
    assert.match(board.overview, /CRO \$0\.1200/);
    assert.match(board.overview, /Cronos DeFi TVL/);
    assert.match(board.overview, /Cronos DEX volume/);
    assert.ok(board.crowded.some((line) => line.includes("Cronos DEX volume chase")));
    assert.ok(board.crowded.some((line) => line.includes("CRO beta")));
    assert.doesNotMatch(text, /SOL\b|Solana|Jito|JLP|Jupiter/);
  });

  it("stands down when Bitcoin and Ethereum are quietly red and sentiment is calm", () => {
    const tape = { btcChange24h: -0.8, ethChange24h: -1.2, l1Change24h: 1, fearGreed: 55, priced: true };
    assert.equal(majorsPerformancePct(-0.8, -1.2).toFixed(2), "-0.90");
    assert.equal(quietRedMarket(tape), true);
    assert.equal(tapeStance(tape), "defensive");
    const board = paintRegime({
      chain: "solana",
      btc: mark(70_000, -0.8),
      eth: mark(3_500, -1.2),
      l1: mark(180, 1),
      btcDom: 55,
      fear: { value: 55, label: "Neutral" },
      tvl: null,
      dexVolume24h: null,
      dexChange1d: null,
    });
    assert.equal(board.stance, "defensive");
    assert.match(board.stanceWhy, /Bitcoin and Ethereum are both red/);
    assert.match(board.overview, /Broad market -0\.90%/);
  });

  it("keeps trading a split tape, a greedy dip, and a real risk-on day", () => {
    assert.equal(tapeStance({ btcChange24h: -0.8, ethChange24h: 0.4, l1Change24h: 1, fearGreed: 55 }), "mixed");
    assert.equal(tapeStance({ btcChange24h: -0.8, ethChange24h: -1.2, l1Change24h: 1, fearGreed: 80 }), "mixed");
    assert.equal(tapeStance({ btcChange24h: -1.8, ethChange24h: -1.8, l1Change24h: 0.2, fearGreed: 55 }), "mixed");
    assert.equal(tapeStance({ btcChange24h: 1, ethChange24h: 0.5, l1Change24h: 2, fearGreed: 50 }), "risk-on");
    assert.equal(tapeStance({ btcChange24h: -3, ethChange24h: 1, l1Change24h: 1, fearGreed: 55 }), "defensive");
  });
});
