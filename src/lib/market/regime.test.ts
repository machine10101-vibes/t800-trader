import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { paintRegime, type RegimeMark } from "./regime";

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
});
