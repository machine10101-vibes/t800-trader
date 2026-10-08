import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  commitTicketCap,
  multipliersForMode,
  nextSettingsDraft,
  normalizeArmFundsUsd,
  normalizeBuySizeUsd,
  normalizeMarginOnFourHour,
  resolveSolTradeMode,
  usdcToLoad,
} from "./deskSettings";
import { DEFAULT_CONFIG, normalizeConfig } from "./store";

describe("arm funds and buy size", () => {
  it("keeps only 25, 50, or 150 for the armed bankroll", () => {
    assert.equal(normalizeArmFundsUsd(25), 25);
    assert.equal(normalizeArmFundsUsd(150), 150);
    assert.equal(normalizeArmFundsUsd(80), 50);
    assert.equal(normalizeBuySizeUsd(25, 50), 25);
    assert.equal(normalizeBuySizeUsd(50, 25), 25);
    assert.equal(usdcToLoad(200, 50, 0), 50);
    assert.equal(usdcToLoad(20, 50, 40), 10);
    assert.equal(usdcToLoad(20, 50, 0), 20);
  });
});

describe("sol trade mode", () => {
  it("infers both from older books that had 5x on, and keeps an explicit margin choice", () => {
    assert.equal(resolveSolTradeMode({ multipliers: [5] }), "both");
    assert.equal(resolveSolTradeMode({ multipliers: [] }), "spot");
    assert.equal(resolveSolTradeMode({ solTradeMode: "margin", multipliers: [] }), "margin");
    assert.equal(resolveSolTradeMode({ startingEquity: 6 }), "spot");
    assert.equal(normalizeMarginOnFourHour(true), true);
    assert.equal(normalizeMarginOnFourHour("yes"), false);
    assert.deepEqual(multipliersForMode("spot", []), []);
    assert.deepEqual(multipliersForMode("margin", []), [5, 10]);
    assert.deepEqual(multipliersForMode("both", [10]), [10]);
  });
});

describe("settings draft", () => {
  it("keeps a $5 ticket cap while the saved book is still $250", () => {
    const saved = normalizeConfig(DEFAULT_CONFIG);
    const draft = normalizeConfig({ ...saved, maxLiveNotionalUsd: 5 });
    assert.equal(saved.maxLiveNotionalUsd, 250);
    assert.equal(draft.maxLiveNotionalUsd, 5);
    assert.equal(nextSettingsDraft(draft, saved, true).maxLiveNotionalUsd, 5);
  });

  it("follows the book again after the edit is saved", () => {
    const saved = normalizeConfig({ ...DEFAULT_CONFIG, maxLiveNotionalUsd: 5 });
    const draft = normalizeConfig({ ...DEFAULT_CONFIG, maxLiveNotionalUsd: 5 });
    assert.equal(nextSettingsDraft(draft, saved, false).maxLiveNotionalUsd, 5);
  });

  it("keeps a typed $5 cap and clamps anything outside $5–$10000", () => {
    assert.equal(commitTicketCap("5", 250), 5);
    assert.equal(commitTicketCap("5.4", 250), 5.4);
    assert.equal(commitTicketCap("", 250), 250);
    assert.equal(commitTicketCap("nope", 250), 250);
    assert.equal(commitTicketCap("1", 250), 5);
    assert.equal(commitTicketCap("99999", 250), 10_000);
  });
});