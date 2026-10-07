import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { exitWords, homeResults, homeStatus, planRules, progressToGoal } from "./home";
import { solanaDefaults } from "./store";

describe("home", () => {
  it("says what the bot is doing in one line", () => {
    const off = homeStatus({ running: false, lastNote: null, blocked: [], lastError: null }, { walletSwaps: false, killSwitch: false }, 0);
    assert.equal(off.title, "Bot is off");
    assert.match(off.detail, /pretend money/);
    const kill = homeStatus({ running: true, lastNote: null, blocked: [], lastError: null }, { walletSwaps: true, killSwitch: true }, 0);
    assert.equal(kill.tone, "crimson");
    const holding = homeStatus({ running: true, lastNote: null, blocked: [], lastError: null }, { walletSwaps: false, killSwitch: false }, 2);
    assert.equal(holding.title, "Holding 2 trades");
    const waiting = homeStatus(
      { running: true, lastNote: "scan", blocked: ["RAY: price feeds disagree", "SOL: 4-hour chart has not loaded"], lastError: null },
      { walletSwaps: false, killSwitch: false },
      0,
    );
    assert.equal(waiting.title, "Watching for a good setup");
    assert.equal(waiting.detail, "SOL: 4-hour chart has not loaded");
  });

  it("measures a trade from its stop to its goal for longs and shorts", () => {
    assert.equal(progressToGoal({ side: "long", stopPrice: 96, targetPrice: 108, markPrice: 102 }), 50);
    assert.equal(progressToGoal({ side: "short", stopPrice: 104, targetPrice: 92, markPrice: 98 }), 50);
    assert.equal(progressToGoal({ side: "long", stopPrice: 96, targetPrice: 108, markPrice: 120 }), 100);
    assert.equal(progressToGoal({ side: "long", stopPrice: 96, targetPrice: 108, markPrice: 90 }), 0);
  });

  it("writes the rules from the live settings", () => {
    const rules = planRules(solanaDefaults());
    assert.ok(rules.some((r) => r.includes("4% below") && r.includes("8% above")));
    assert.ok(rules.some((r) => r.includes("never sold until it beats the fees")));
    assert.ok(!rules.some((r) => r.includes("loses faster")));
    assert.ok(planRules({ ...solanaDefaults(), multipliers: [5] }).some((r) => r.includes("5x")));
  });

  it("sums closed results and words every exit", () => {
    const r = homeResults([
      { action: "open", pnlUsd: null },
      { action: "close", pnlUsd: 3 },
      { action: "close", pnlUsd: -1 },
    ]);
    assert.deepEqual(r, { closed: 2, wins: 1, netUsd: 2, bestUsd: 3, worstUsd: -1 });
    assert.equal(exitWords("target"), "Hit the profit goal");
    assert.equal(exitWords("stop"), "Hit the safety stop");
  });
});
