import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "./store";
import { buildMonitor, parseWalletAddress, watchHref } from "./monitor";

const SOL = "So11111111111111111111111111111111111111112";

describe("monitor", () => {
  it("accepts a Solana address and rejects junk", () => {
    assert.equal(parseWalletAddress(`  ${SOL}  `), SOL);
    assert.equal(parseWalletAddress(""), null);
    assert.equal(parseWalletAddress("not-a-wallet"), null);
    assert.equal(parseWalletAddress("1111111111111111111111111111111"), null);
  });

  it("builds a read-only view from a saved book and a live mark", () => {
    const book = emptyState({ startingEquity: 12 });
    book.bot.running = true;
    book.bot.ticks = 4;
    book.bot.lastNote = "Tick 4";
    book.portfolio.winCount = 2;
    book.portfolio.lossCount = 1;
    book.trades = [
      {
        id: "t",
        mint: "m",
        symbol: "SOL",
        side: "long",
        action: "close",
        qty: 1,
        price: 100,
        pnlUsd: 0.4,
        pnlPct: 1,
        reason: "target",
        at: "2026-09-24T00:00:00Z",
        note: "target",
        signature: "5signed",
      },
      {
        id: "paper",
        mint: "m",
        symbol: "JUP",
        side: "long",
        action: "open",
        qty: 1,
        price: 1,
        pnlUsd: null,
        pnlPct: null,
        reason: "reclaim",
        at: "2026-09-24T00:01:00Z",
        note: "paper",
      },
    ];
    const view = buildMonitor(SOL, book, { address: SOL, sol: 0.1, usdc: 2, solPriceUsd: 100, equityUsd: 12 });
    assert.equal(view.hasBook, true);
    assert.equal(view.running, true);
    assert.equal(view.paperEquityUsd, 12);
    assert.equal(view.walletEquityUsd, 12);
    assert.equal(view.hitRate, (2 / 3) * 100);
    assert.equal(view.trades.length, 1);
    assert.equal(view.trades[0]?.signature, "5signed");
    assert.match(view.learningSummary ?? "", /No graded/);
  });

  it("still reports the wallet when this browser has no paper book", () => {
    const view = buildMonitor(SOL, null, { address: SOL, sol: 0.05, usdc: 0, solPriceUsd: 80, equityUsd: 4 });
    assert.equal(view.hasBook, false);
    assert.equal(view.walletEquityUsd, 4);
    assert.equal(view.paperEquityUsd, null);
    assert.equal(view.positions.length, 0);
    assert.equal(watchHref(SOL, "/t800-trader"), `/t800-trader/?watch=${SOL}`);
  });
});
