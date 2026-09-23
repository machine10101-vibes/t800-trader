import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, emptyState, isIdleEmptyBook, seedFromLiveEquity } from "./store";

describe("store", () => {
  it("reseeds an idle empty book once the live wallet is at least $5", () => {
    const idle = emptyState({ ...DEFAULT_CONFIG, startingEquity: 0 });
    assert.equal(isIdleEmptyBook(idle), true);

    const stillDust = seedFromLiveEquity(idle, 4);
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
});
