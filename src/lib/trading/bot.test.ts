import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../store";
import { applyControl } from "./bot";

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
});
