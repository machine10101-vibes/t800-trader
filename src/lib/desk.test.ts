import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ACTIVE_BOOK, BOOK_POOLS, WATCHLIST } from "./market/universe";
import { armButton, shellDesk, watchlistTapes } from "./desk";
import { emptyState } from "./store";
import type { TokenCandidate } from "./types";

describe("armButton", () => {
  it("disarms when the book is already running", () => {
    assert.deepEqual(armButton(true), { action: "stop", label: "Disarm the bot" });
    assert.deepEqual(armButton(false), { action: "start", label: "Arm the bot" });
  });
});

describe("shellDesk", () => {
  it("shows a saved armed book as armed and leaves a fresh book disarmed", () => {
    const armed = emptyState();
    armed.bot.running = true;
    armed.bot.lastNote = "Armed — first tick incoming";
    const shell = shellDesk(armed);
    assert.equal(shell.bot.running, true);
    assert.equal(shell.bot.lastNote, "Armed — first tick incoming");
    assert.equal(shell.research.length, 0);
    assert.equal(shell.regime.sol.price, 0);
    assert.equal(shell.portfolio, armed.portfolio);

    const fresh = shellDesk(emptyState());
    assert.equal(fresh.bot.running, false);
    assert.equal(fresh.tapes.length, 0);
  });
});

describe("watchlistTapes", () => {
  it("keeps one 5-minute tape per watchlist name and drops everything else", () => {
    const sol = WATCHLIST.find((token) => token.symbol === "SOL")!;
    const jup = WATCHLIST.find((token) => token.symbol === "JUP")!;
    const zbcn = WATCHLIST.find((token) => token.symbol === "ZBCN")!;
    const flow = { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 0.4 };
    const row = (token: typeof sol, pool: string, liquidityUsd: number): TokenCandidate =>
      ({
        symbol: token.symbol,
        mint: token.mint,
        poolAddress: pool,
        liquidityUsd,
        watchlist: true,
        flows: { m5: flow, m15: flow, m30: flow, h1: flow, h6: flow, h24: flow },
      }) as TokenCandidate;
    const tapes = watchlistTapes([
      row(jup, "jup-thin", 1_000),
      row(jup, "jup-deep", 9_000),
      row(sol, "sol-pool", 50_000),
      { ...row(sol, "other", 1), symbol: "PUMP", mint: "pump", watchlist: false } as TokenCandidate,
    ]);
    assert.deepEqual(
      tapes.map((tape) => tape.symbol),
      ["SOL"],
    );
    assert.equal(tapes.some((tape) => tape.symbol === "JUP"), false);
    const withZebec = watchlistTapes([
      row(jup, "jup-deep", 9_000),
      row(sol, "sol-pool", 50_000),
      row(zbcn, "zbcn-sol", 150_000),
    ]);
    assert.deepEqual(
      withZebec.map((tape) => tape.symbol),
      ["SOL", "ZBCN"],
    );
    assert.equal(withZebec[1]?.poolAddress, "zbcn-sol");
  });
});

describe("BOOK_POOLS", () => {
  it("pins one pool for every name the desk trades", () => {
    const pinned = new Set(BOOK_POOLS.map((pin) => pin.mint));
    for (const mint of ACTIVE_BOOK) assert.equal(pinned.has(mint), true);
    assert.equal(BOOK_POOLS.length, ACTIVE_BOOK.length);
    assert.equal(new Set(BOOK_POOLS.map((pin) => pin.pool)).size, BOOK_POOLS.length);
  });
});
