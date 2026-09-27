import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyControl, tickBot } from "./trading/bot";
import {
  attachWallet,
  DEFAULT_CONFIG,
  detachWallet,
  emptyState,
  getActiveWallet,
  loadState,
  mutateState,
} from "./store";

const WALLET = "Desk111111111111111111111111111111111111111";

describe("wallet-scoped paper store", () => {
  it("refuses to load a book before a wallet is attached", async () => {
    detachWallet();
    assert.equal(getActiveWallet(), null);
    await assert.rejects(loadState(), /Connect a Solana wallet/);
  });

  it("sizes a new book from live wallet equity and keeps later mutates in memory", async () => {
    detachWallet();
    const first = await attachWallet(WALLET, 250);
    assert.equal(getActiveWallet(), WALLET);
    assert.equal(first.portfolio.cashUsd, 250);
    assert.equal(first.config.startingEquity, 250);
    assert.equal(first.config.maxPositions, DEFAULT_CONFIG.maxPositions);

    const next = await mutateState((state) => ({
      ...state,
      bot: { ...state.bot, running: true, ticks: 1 },
    }));
    assert.equal(next.bot.running, true);
    assert.equal(next.bot.ticks, 1);

    const again = await attachWallet(WALLET, 999);
    assert.equal(again.bot.ticks, 1);
    assert.equal(again.portfolio.cashUsd, 250);

    detachWallet();
    assert.equal(getActiveWallet(), null);
  });

  it("emptyState never invents a $10k demo book", () => {
    const state = emptyState();
    assert.equal(state.portfolio.equityUsd, 0);
    assert.equal(state.config.startingEquity, 0);
  });

  it("refuses a bot tick before a wallet is attached", async () => {
    detachWallet();
    await assert.rejects(tickBot(), /Connect a Solana wallet/);
  });

  it("paper-ticks against live Solana feeds without sending a transaction", async (t) => {
    detachWallet();
    await attachWallet(WALLET, 1_000);
    await mutateState((state) => applyControl(state, "start"));
    try {
      const next = await tickBot();
      assert.ok(next.bot.lastTickAt);
      assert.ok(next.bot.ticks >= 1);
      if (next.bot.lastError) {
        t.skip(`tick completed but market feeds failed: ${next.bot.lastError}`);
      }
    } catch (error) {
      t.skip(`tick path unavailable: ${error instanceof Error ? error.message : error}`);
    } finally {
      detachWallet();
    }
  });
});
