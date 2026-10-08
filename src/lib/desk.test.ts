import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ACTIVE_BOOK, BOOK_POOLS, WCRO_MINT, WATCHLIST, bookPools, bookTokens } from "./market/universe";
import { readDeskChain, writeDeskChain } from "./chain";
import { readLastWallet, writeLastWallet } from "./store";
import { armButton, shellDesk, watchlistTapes } from "./desk";
import { emptyState } from "./store";
import type { TokenCandidate } from "./types";

describe("armButton", () => {
  it("disarms when the book is already running", () => {
    assert.deepEqual(armButton(true), { action: "stop", label: "Disarm the bot" });
    assert.deepEqual(armButton(false), { action: "start", label: "Arm the bot" });
  });
});

describe("desk chain", () => {
  it("opens the same chain after a refresh", () => {
    const store = new Map<string, string>();
    (globalThis as { window?: { localStorage: Storage } }).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => store.clear(),
        key: () => null,
        length: 0,
      },
    };
    assert.equal(readDeskChain(), "solana");
    writeDeskChain("cronos");
    assert.equal(readDeskChain(), "cronos");
    writeLastWallet("cronos", "0xabc");
    writeLastWallet("solana", "So1");
    assert.equal(readLastWallet("cronos"), "0xabc");
    assert.equal(readLastWallet("solana"), "So1");
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
  it("keeps one 1-minute tape per watchlist name and drops everything else", () => {
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
        priceUsd: 120,
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
    assert.equal(tapes[0]?.price, 120);
    assert.equal(tapes[0]?.change5m, 0.4);
    assert.equal(tapes[0]?.change15m, 0.4);
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
    assert.deepEqual(
      bookTokens("cronos").map((token) => token.symbol),
      ["CRO", "ULTCAT", "CRIMECAT", "MERY", "PACK", "ULTI"],
    );
    assert.equal(bookPools("cronos").length, 6);
    assert.equal(bookPools("cronos")[0]?.mint, WCRO_MINT);
    assert.equal(new Set(bookPools("cronos").map((pin) => pin.pool)).size, 6);
    const flow = { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 0.4 };
    const croTapes = watchlistTapes(
      bookTokens("cronos").map((token) => ({
        symbol: token.symbol,
        mint: token.mint,
        poolAddress: `${token.symbol.toLowerCase()}-pool`,
        liquidityUsd: 1_000,
        watchlist: false,
        flows: { m5: flow, m15: flow, m30: flow, h1: flow, h6: flow, h24: flow },
      })) as TokenCandidate[],
      "cronos",
    );
    assert.deepEqual(
      croTapes.map((tape) => tape.symbol),
      ["CRO", "ULTCAT", "CRIMECAT", "MERY", "PACK", "ULTI"],
    );
  });
});
