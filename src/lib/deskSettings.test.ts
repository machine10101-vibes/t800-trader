import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  appliedScanSeconds,
  armedFundsUsd,
  commitTicketCap,
  logicFramesRule,
  multipliersForMode,
  nextSettingsDraft,
  normalizeArmFundsUsd,
  normalizeBuySizeUsd,
  normalizeCronosQuote,
  normalizeLogicFrames,
  normalizeMarginOnFourHour,
  normalizeRulesOn,
  quoteSlippageBps,
  resolveSolTradeMode,
  ruleOn,
  ticketBuyUsd,
  toggleLogicFrame,
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

describe("logic frames", () => {
  it("keeps the 15-minute path when a book never stored the setting", () => {
    assert.deepEqual(normalizeLogicFrames(undefined), ["15m", "1h", "4h"]);
    assert.deepEqual(normalizeLogicFrames([]), ["15m", "1h", "4h"]);
    assert.deepEqual(normalizeLogicFrames(["4h", "nope", "5m", "4h"]), ["5m", "4h"]);
    assert.deepEqual(normalizeConfig({}).logicFrames, ["15m", "1h", "4h"]);
    assert.deepEqual(normalizeConfig({ logicFrames: ["5m"] }).logicFrames, ["5m"]);
  });

  it("will not turn off the last chart", () => {
    assert.deepEqual(toggleLogicFrame(["15m"], "15m", false), ["15m"]);
    assert.deepEqual(toggleLogicFrame(["15m", "4h"], "15m", false), ["4h"]);
    assert.deepEqual(toggleLogicFrame(["15m"], "5m", true), ["5m", "15m"]);
    assert.match(logicFramesRule(["15m", "1h", "4h"]), /15-minute chart/);
    assert.match(logicFramesRule(["4h"]), /4-hour chart/);
    assert.doesNotMatch(logicFramesRule(["4h"]), /then checks/);
  });
});

describe("cronos quote", () => {
  it("keeps USDC unless the book saved CRO", () => {
    assert.equal(normalizeCronosQuote(undefined), "usdc");
    assert.equal(normalizeCronosQuote("cro"), "cro");
    assert.equal(normalizeCronosQuote("usdc"), "usdc");
    assert.equal(normalizeCronosQuote("sol"), "usdc");
    assert.equal(normalizeConfig({ cronosQuote: "cro" }).cronosQuote, "cro");
    assert.equal(normalizeConfig({}).cronosQuote, "usdc");
  });
});

describe("rule switches", () => {
  it("keeps every rule on when an older book never stored the switches", () => {
    const rules = normalizeRulesOn(undefined);
    assert.equal(ruleOn({ rulesOn: rules }, "stopLoss"), true);
    assert.equal(ruleOn({}, "dailyLoss"), true);
    assert.equal(normalizeConfig({}).rulesOn.stopLoss, true);
    assert.equal(normalizeConfig({ rulesOn: { ...rules, stopLoss: false, scan: false } }).rulesOn.stopLoss, false);
    assert.equal(normalizeConfig({ rulesOn: { ...rules, stopLoss: false } }).rulesOn.targetProfit, true);
  });

  it("uses the built-in number when that rule is off", () => {
    const off = normalizeRulesOn({ armFunds: false, buySize: false, scan: false, slippage: false });
    assert.equal(armedFundsUsd({ armFundsUsd: 150, rulesOn: off }), 50);
    assert.equal(ticketBuyUsd({ armFundsUsd: 150, buySizeUsd: 50, rulesOn: off }), 10);
    assert.equal(appliedScanSeconds({ scanSeconds: 30, rulesOn: off }), 5);
    assert.equal(quoteSlippageBps({ slippageBps: 150, rulesOn: off }), 80);
    assert.equal(quoteSlippageBps({ slippageBps: 150, rulesOn: normalizeRulesOn({ slippage: true }) }), 150);
    assert.equal(armedFundsUsd({ armFundsUsd: 25, rulesOn: normalizeRulesOn(undefined) }), 25);
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