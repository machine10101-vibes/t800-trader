import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { botActivity, exitWords, homeResults, homeStatus, planRules, progressToGoal, visibleActivity } from "./home";
import { solanaDefaults } from "./store";
import type { Portfolio, Position, Trade } from "./types";

const book = (over: Partial<Portfolio> = {}): Portfolio => ({
  cashUsd: 200,
  equityUsd: 200,
  peakEquity: 200,
  dayStartEquity: 200,
  dayPnlUsd: 0,
  realizedPnlUsd: 0,
  unrealizedPnlUsd: 0,
  winCount: 0,
  lossCount: 0,
  tradeCount: 0,
  ...over,
});

function ticket(over: Partial<Position> = {}): Position {
  return {
    id: "p",
    mint: "m",
    symbol: "SOL",
    poolAddress: "x",
    sector: "L1",
    side: "long",
    qty: 1,
    entryPrice: 100,
    markPrice: 103,
    stopPrice: 96,
    targetPrice: 108,
    openedAt: new Date().toISOString(),
    lastUpdate: new Date().toISOString(),
    reason: "breakout",
    researchScore: 70,
    highWater: 103,
    lowWater: 100,
    notional: 103,
    initialStop: 96,
    scaled: false,
    ...over,
  };
}

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
    assert.ok(rules.some((r) => r.includes("stop above and the goal below")));
    assert.ok(rules.some((r) => r.includes("bet a price will fall")));
    assert.ok(!planRules({ ...solanaDefaults(), allowShorts: false }).some((r) => r.includes("bet a price will fall")));
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

  it("separates a goal wait, a limit, and a wall", () => {
    const now = Date.now();
    const config = { ...solanaDefaults(), maxPositions: 1, lossStreakPause: 3, dailyLossLimitPct: 6 };
    const losses = [-1, -1, -1].map((pnlUsd, i) => ({ action: "close", pnlUsd, at: new Date(now - 60_000).toISOString(), mint: `m${i}` }) as Trade);
    const quiet = botActivity({
      running: true,
      killSwitch: false,
      lastError: null,
      lastTickAt: new Date(now).toISOString(),
      ticks: 4,
      blocked: ["SOL: no 15-minute setup yet", "RAY: dropping right now (-0.40% in 15 minutes), so it waits"],
      scanSeconds: 5,
      positions: [],
      trades: [],
      portfolio: book(),
      config,
      nowMs: now,
    });
    assert.equal(quiet.targets.length, 0);
    assert.equal(quiet.limits.length, 0);
    assert.equal(quiet.walls.length, 0);
    assert.match(quiet.summary, /waiting for a 15-minute setup/);
    assert.deepEqual(visibleActivity(quiet), []);

    const held = botActivity({
      running: true,
      killSwitch: false,
      lastError: null,
      lastTickAt: new Date(now).toISOString(),
      ticks: 4,
      blocked: [
        "SOL: the gain does not beat the fee to open and the fee to close yet",
        "PUMP: 4-hour chart has not loaded",
        "ZEC long: Holding 1 coins, the most allowed at once",
      ],
      scanSeconds: 5,
      positions: [ticket()],
      trades: losses,
      portfolio: book({ equityUsd: 180, dayPnlUsd: -20 }),
      config,
      nowMs: now,
    });
    assert.match(held.targets[0]?.text ?? "", /SOL is waiting for its profit goal/);
    assert.match(held.targets[0]?.text ?? "", /not bigger than the buy and sell fees/);
    assert.ok(held.limits.some((item) => /most allowed at once/.test(item.text)));
    assert.ok(held.limits.some((item) => /6% limit/.test(item.text)));
    assert.ok(held.limits.some((item) => /Resting for an hour/.test(item.text)));
    assert.equal(held.limits.filter((item) => /most allowed/.test(item.text)).length, 1);
    assert.equal(held.walls.length, 0);
    assert.match(held.summary, /profit goals/);
    assert.deepEqual(
      visibleActivity(held).map((group) => group.kind),
      ["limit", "target"],
    );

    const loading = botActivity({
      running: true,
      killSwitch: false,
      lastError: null,
      lastTickAt: new Date(now).toISOString(),
      ticks: 1,
      blocked: ["PUMP: 4-hour chart has not loaded", "SOL: pool tape has not arrived"],
      scanSeconds: 5,
      positions: [],
      trades: [],
      portfolio: book(),
      config,
      nowMs: now,
    });
    assert.equal(loading.walls.length, 0);
    assert.equal(loading.limits.length, 0);
    assert.match(loading.summary, /waiting for a 15-minute setup/);

    const split = botActivity({
      running: true,
      killSwitch: false,
      lastError: null,
      lastTickAt: new Date(now).toISOString(),
      ticks: 2,
      blocked: ["RAY: price feeds disagree"],
      scanSeconds: 5,
      positions: [],
      trades: [],
      portfolio: book(),
      config,
      nowMs: now,
    });
    assert.deepEqual(
      split.walls.map((item) => item.text),
      ["RAY: price feeds disagree"],
    );

    const stuck = botActivity({
      running: true,
      killSwitch: false,
      lastError: null,
      lastTickAt: new Date(now - 3 * 60_000).toISOString(),
      ticks: 2,
      blocked: [],
      scanSeconds: 5,
      positions: [],
      trades: [],
      portfolio: book(),
      config,
      nowMs: now,
    });
    assert.match(stuck.walls[0]?.text ?? "", /looks stuck/);

    const afterReload = botActivity({
      running: true,
      killSwitch: false,
      lastError: null,
      lastTickAt: new Date(now - 3 * 60_000).toISOString(),
      ticks: 2,
      blocked: [],
      scanSeconds: 5,
      positions: [],
      trades: [],
      portfolio: book(),
      config,
      nowMs: now,
      pageStartedAt: now - 5_000,
    });
    assert.equal(afterReload.walls.length, 0);

    const minuteAfterReload = botActivity({
      running: true,
      killSwitch: false,
      lastError: null,
      lastTickAt: new Date(now - 5 * 60_000).toISOString(),
      ticks: 2,
      blocked: [],
      scanSeconds: 5,
      positions: [],
      trades: [],
      portfolio: book(),
      config,
      nowMs: now,
      pageStartedAt: now - 60_000,
    });
    assert.equal(minuteAfterReload.walls.length, 0);

    const off = botActivity({
      running: false,
      killSwitch: false,
      lastError: null,
      lastTickAt: null,
      ticks: 0,
      blocked: [],
      scanSeconds: 5,
      positions: [ticket()],
      trades: [],
      portfolio: book(),
      config,
      nowMs: now,
    });
    assert.equal(off.limits.length, 0);
    assert.equal(off.walls.length, 0);
    assert.match(off.summary, /bot is off so it will not sell/);
    assert.deepEqual(
      visibleActivity(off).map((group) => group.kind),
      ["target"],
    );

    const limited = botActivity({
      running: true,
      killSwitch: false,
      lastError: null,
      lastTickAt: new Date(now).toISOString(),
      ticks: 4,
      blocked: ["SOL: the gain does not beat the fee to open and the fee to close yet"],
      scanSeconds: 5,
      positions: [ticket()],
      trades: losses,
      portfolio: book({ equityUsd: 180, dayPnlUsd: -20 }),
      config,
      nowMs: now,
    });
    assert.deepEqual(
      visibleActivity(limited).map((group) => group.kind),
      ["limit", "target"],
    );
  });
});
