import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, emptyState, freshBook, isIdleEmptyBook, normalizeConfig, seedFromLiveEquity } from "./store";

describe("store", () => {
  it("reseeds an idle empty book once the live wallet is at least $3", () => {
    const idle = emptyState({ ...DEFAULT_CONFIG, startingEquity: 0 });
    assert.equal(isIdleEmptyBook(idle), true);

    const stillDust = seedFromLiveEquity(idle, 2);
    assert.equal(stillDust.portfolio.cashUsd, 0);

    const funded = seedFromLiveEquity(idle, 6);
    assert.equal(funded.portfolio.cashUsd, 6);
    assert.equal(funded.portfolio.equityUsd, 6);
    assert.equal(funded.config.startingEquity, 6);
  });

  it("does not overwrite a book that already traded", () => {
    const traded = emptyState({ ...DEFAULT_CONFIG, startingEquity: 0 });
    traded.trades = [{ id: "t" } as never];
    const next = seedFromLiveEquity(traded, 12);
    assert.equal(next.portfolio.cashUsd, 0);
    assert.equal(next, traded);
  });

  it("adopts a live mark onto a flat book and leaves a traded or sub-$3 mark alone", () => {
    const flat = emptyState({ ...DEFAULT_CONFIG, startingEquity: 100 });
    const adopted = freshBook(flat, 6);
    assert.equal(adopted.portfolio.cashUsd, 6);
    assert.equal(adopted.portfolio.equityUsd, 6);
    assert.equal(adopted.config.startingEquity, 6);

    const dusty = freshBook(flat, 2);
    assert.equal(dusty, flat);
    assert.equal(dusty.portfolio.cashUsd, 100);

    const traded = emptyState({ ...DEFAULT_CONFIG, startingEquity: 100 });
    traded.trades = [{ id: "t" } as never];
    assert.equal(freshBook(traded, 8), traded);

    const open = emptyState({ ...DEFAULT_CONFIG, startingEquity: 100 });
    open.positions = [{ id: "p" } as never];
    assert.equal(freshBook(open, 8), open);
  });

  it("fills policy fields an older book never saved", () => {
    const next = normalizeConfig({ startingEquity: 6, maxPositions: 2, scanSeconds: 4 });
    assert.equal(next.startingEquity, 6);
    assert.equal(next.maxPositions, 2);
    assert.equal(next.scanSeconds, 4);
    assert.equal(normalizeConfig({ scanSeconds: 2 }).scanSeconds, 4);
    assert.equal(next.oneTicketPerTick, true);
    assert.equal(next.minConfidence, 58);
    assert.equal(next.autoCash, true);
    assert.equal(next.beR, 0.8);
    assert.equal(next.venues.includes("raydium"), true);
    assert.equal(next.venues.includes("pump"), true);
    assert.deepEqual(normalizeConfig({ venues: ["orca", "nope"] }).venues, ["orca"]);
    assert.deepEqual(normalizeConfig({ venues: [] }).venues, []);
    assert.equal(next.walletSwaps, true);
    assert.equal(next.liveTradesRev, 1);
    assert.equal(normalizeConfig({ walletSwaps: false }).walletSwaps, true);
    assert.equal(normalizeConfig({ walletSwaps: false, liveTradesRev: 1 }).walletSwaps, false);
  });
});
