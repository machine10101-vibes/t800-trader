import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../store";
import type { Signal } from "../types";
import { applyControl } from "./bot";
import { openPosition } from "./paper";

function signal(over: Partial<Signal> = {}): Signal {
  return {
    id: "s",
    mint: "mint",
    symbol: "SOL",
    poolAddress: "pool",
    sector: "L1",
    side: "long",
    reason: "reclaim",
    confidence: 70,
    price: 100,
    stopPct: 2,
    targetPct: 4,
    thesis: "t",
    researchScore: 65,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

const config = emptyState().config;

describe("bot control", () => {
  it("arms, disarms, and resets the paper book without touching a chain", () => {
    const started = applyControl(emptyState({ ...config, startingEquity: 1_000 }), "start");
    assert.equal(started.bot.running, true);
    assert.ok(started.bot.startedAt);

    const stopped = applyControl(started, "stop");
    assert.equal(stopped.bot.running, false);
    assert.equal(stopped.portfolio.cashUsd, 1_000);

    const dirtied = { ...started, portfolio: { ...started.portfolio, tradeCount: 3 } };
    const reset = applyControl(dirtied, "reset");
    assert.equal(reset.bot.running, false);
    assert.equal(reset.portfolio.tradeCount, 0);
    assert.equal(reset.portfolio.cashUsd, 1_000);
    assert.equal(reset.positions.length, 0);
  });

  it("flatten exits every ticket and stop leaves the book", () => {
    let state = emptyState({ ...config, startingEquity: 1_000 });
    state = openPosition(state, signal({ mint: "mint-a", symbol: "AAA", price: 100 }), 1);
    state = openPosition(state, signal({ mint: "mint-b", symbol: "BBB", price: 50 }), 1);
    assert.equal(state.positions.length, 2);
    const stopped = applyControl(state, "stop");
    assert.equal(stopped.bot.running, false);
    assert.equal(stopped.positions.length, 2);
    const flat = applyControl(state, "flatten");
    assert.equal(flat.positions.length, 0);
    assert.equal(flat.bot.running, false);
  });

  it("takes 10% of Solana flatten winners and leaves a Cronos flatten whole", () => {
    let state = emptyState({ ...config, startingEquity: 1_000 });
    state = openPosition(state, signal({ mint: "mint-a", symbol: "AAA", price: 100 }), 1);
    state = {
      ...state,
      positions: state.positions.map((pos) => ({ ...pos, markPrice: pos.entryPrice * 1.4 })),
    };
    const sol = applyControl(state, "flatten", "solana");
    const cro = applyControl(state, "flatten", "cronos");
    assert.equal(sol.positions.length, 0);
    assert.match(sol.trades[0]!.note, /Shared \$/);
    assert.ok(!cro.trades[0]!.note.includes("Shared $"));
    assert.ok(sol.portfolio.cashUsd < cro.portfolio.cashUsd);
  });

  it("kill switch flips the desk back to paper and stops the bot", () => {
    const started = applyControl(emptyState({ ...config, startingEquity: 1_000, executionMode: "live" }), "start");
    const killed = applyControl(started, "kill");
    assert.equal(killed.bot.running, false);
    assert.equal(killed.config.executionMode, "paper");
    assert.equal(killed.config.killSwitch, true);
    assert.equal(killed.portfolio.cashUsd, 1_000);
  });
});
