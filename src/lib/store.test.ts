import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  adoptPostedBook,
  bookStorageKey,
  emptyState,
  freshBook,
  isIdleEmptyBook,
  listLocalBooks,
  normalizeConfig,
  readLastWallet,
  resumeSavedBook,
  seedFromLiveEquity,
  SOLANA_STRATEGY,
  solanaDefaults,
  useDeskStore,
  withSolanaStrategy,
  writeLastWallet,
} from "./store";

describe("store", () => {
  it("reseeds an idle empty book to the chosen arm size", () => {
    const idle = emptyState({ ...DEFAULT_CONFIG, startingEquity: 0, armFundsUsd: 50 });
    assert.equal(isIdleEmptyBook(idle), true);

    const liveDust = seedFromLiveEquity({ ...idle, config: { ...idle.config, walletSwaps: true } }, 2);
    assert.equal(liveDust.portfolio.cashUsd, 0);

    const paper = seedFromLiveEquity(idle, 2);
    assert.equal(paper.portfolio.cashUsd, 50);
    assert.equal(paper.config.startingEquity, 50);
    assert.equal(paper.config.buySizeUsd, 10);
  });

  it("reopens the last wallet book after a refresh and drops the LIVE lock wall", async () => {
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
    writeLastWallet("cronos", "0xabc");
    assert.equal(readLastWallet("cronos"), "0xabc");
    const armed = emptyState({ ...DEFAULT_CONFIG, startingEquity: 20, walletSwaps: true, executionMode: "live" });
    armed.bot.running = true;
    armed.bot.blocked = ["Re-confirm LIVE this session before sending swaps"];
    store.set(bookStorageKey("solana", "So1Refresh"), JSON.stringify(armed));
    writeLastWallet("solana", "So1Refresh");
    const book = await resumeSavedBook("solana");
    assert.equal(book?.bot.running, true);
    assert.equal((book?.bot.blocked ?? []).some((line) => /re-confirm live/i.test(line)), false);
  });

  it("keeps an armed bot running when an empty book is reseeded after a refresh", () => {
    const idle = emptyState({ ...DEFAULT_CONFIG, startingEquity: 0 });
    idle.bot.running = true;
    idle.bot.startedAt = "2026-01-01T00:00:00.000Z";
    idle.bot.lastNote = "Armed — first tick incoming";
    const funded = seedFromLiveEquity(idle, 6);
    assert.equal(funded.bot.running, true);
    assert.equal(funded.bot.startedAt, "2026-01-01T00:00:00.000Z");
    assert.equal(funded.portfolio.equityUsd, funded.config.armFundsUsd);

    const flat = emptyState({ ...DEFAULT_CONFIG, startingEquity: 100, armFundsUsd: 25 });
    flat.bot.running = true;
    const adopted = freshBook(flat, 12);
    assert.equal(adopted.bot.running, true);
    assert.equal(adopted.portfolio.equityUsd, 25);
  });

  it("does not overwrite a book that already traded", () => {
    const traded = emptyState({ ...DEFAULT_CONFIG, startingEquity: 0 });
    traded.trades = [{ id: "t" } as never];
    const next = seedFromLiveEquity(traded, 12);
    assert.equal(next.portfolio.cashUsd, 0);
    assert.equal(next, traded);
  });

  it("adopts a live mark onto a flat book and leaves a traded or sub-$3 mark alone", () => {
    const flat = emptyState({ ...DEFAULT_CONFIG, startingEquity: 100 });
    const adopted = freshBook({ ...flat, config: { ...flat.config, armFundsUsd: 50 } }, 6);
    assert.equal(adopted.portfolio.cashUsd, 50);
    assert.equal(adopted.portfolio.equityUsd, 50);
    assert.equal(adopted.config.startingEquity, 50);

    const dusty = freshBook({ ...flat, config: { ...flat.config, walletSwaps: true } }, 2);
    assert.equal(dusty.portfolio.cashUsd, 100);
    const paperDust = freshBook(flat, 2);
    assert.equal(paperDust.portfolio.cashUsd, paperDust.config.armFundsUsd);

    const traded = emptyState({ ...DEFAULT_CONFIG, startingEquity: 100 });
    traded.trades = [{ id: "t" } as never];
    assert.equal(freshBook(traded, 8), traded);

    const open = emptyState({ ...DEFAULT_CONFIG, startingEquity: 100 });
    open.positions = [{ id: "p" } as never];
    assert.equal(freshBook(open, 8), open);
  });

  it("fills policy fields an older book never saved", () => {
    const next = normalizeConfig({ startingEquity: 6, maxPositions: 2, scanSeconds: 4 });
    assert.equal(next.startingEquity, 6);
    assert.equal(next.maxPositions, 2);
    assert.equal(next.scanSeconds, 4);
    assert.equal(normalizeConfig({ scanSeconds: 2 }).scanSeconds, 4);
    assert.equal(next.oneTicketPerTick, true);
    assert.equal(next.minConfidence, 58);
    assert.equal(next.autoCash, true);
    assert.equal(next.beR, 0.8);
    assert.equal(next.stopLossPct, 2);
    assert.equal(next.targetProfitPct, 4);
    assert.equal(normalizeConfig({ stopLossPct: 0.1, targetProfitPct: 80 }).stopLossPct, 0.4);
    assert.equal(normalizeConfig({ stopLossPct: 0.1, targetProfitPct: 80 }).targetProfitPct, 30);
    assert.equal(next.venues.includes("raydium"), true);
    assert.equal(next.venues.includes("pump"), true);
    assert.deepEqual(normalizeConfig({ venues: ["orca", "nope"] }).venues, ["orca"]);
    assert.deepEqual(normalizeConfig({ venues: [] }).venues, []);
    assert.equal(next.allowShorts, false);
    assert.equal(normalizeConfig({ allowShorts: true }).allowShorts, false);
    assert.equal(next.walletSwaps, false);
    assert.equal(next.executionMode, "paper");
    assert.equal(next.armFundsUsd, 50);
    assert.equal(next.buySizeUsd, 10);
    assert.equal(next.cronosQuote, "usdc");
    assert.equal(normalizeConfig({ cronosQuote: "cro" }).cronosQuote, "cro");
    assert.equal(next.killSwitch, false);
    assert.equal(next.liveTradesRev, 1);
    assert.equal(normalizeConfig({ walletSwaps: true }).walletSwaps, false);
    assert.equal(normalizeConfig({ walletSwaps: true, liveTradesRev: 1 }).walletSwaps, true);
    assert.equal(normalizeConfig({ executionMode: "live" }).walletSwaps, true);
    assert.equal(normalizeConfig({ walletSwaps: false, liveTradesRev: 1 }).walletSwaps, false);
  });

  it("moves a saved Solana book onto the tested strategy once, keeping its own limits", () => {
    const saved = normalizeConfig({ ...DEFAULT_CONFIG, maxLiveNotionalUsd: 40, slippageBps: 120 });
    assert.equal(saved.strategyRev, 0);
    const moved = withSolanaStrategy(saved);
    assert.equal(moved.stopLossPct, SOLANA_STRATEGY.stopLossPct);
    assert.equal(moved.targetProfitPct, SOLANA_STRATEGY.targetProfitPct);
    assert.equal(moved.scratchEnabled, false);
    assert.deepEqual(moved.multipliers, []);
    assert.equal(moved.strategyRev, 1);
    assert.equal(moved.maxLiveNotionalUsd, 40);
    assert.equal(moved.slippageBps, 120);
    assert.equal(moved.walletSwaps, false);

    const edited = normalizeConfig({ ...moved, multipliers: [5], stopLossPct: 3 });
    assert.equal(withSolanaStrategy(edited), edited);
    assert.equal(solanaDefaults().timeCapMin, 360);
    assert.equal(solanaDefaults().solTradeMode, "spot");
    assert.equal(solanaDefaults().marginOnFourHour, false);
  });

  it("infers Solana spot vs both from older books that never stored a mode", () => {
    assert.equal(normalizeConfig({ multipliers: [5, 10] }).solTradeMode, "both");
    assert.equal(normalizeConfig({ multipliers: [] }).solTradeMode, "spot");
    assert.equal(normalizeConfig({ solTradeMode: "margin", multipliers: [] }).solTradeMode, "margin");
    assert.equal(normalizeConfig({ solTradeMode: "both", marginOnFourHour: true }).marginOnFourHour, true);
    assert.deepEqual(normalizeConfig({}).logicFrames, ["15m", "1h", "4h"]);
    assert.deepEqual(normalizeConfig({ logicFrames: ["5m", "4h"] }).logicFrames, ["5m", "4h"]);
    assert.equal(normalizeConfig({ startingEquity: 6 }).solTradeMode, "spot");
  });

  it("loads a posted book from the desk file backend without a window", async () => {
    const prior = (globalThis as { window?: unknown }).window;
    delete (globalThis as { window?: unknown }).window;
    const store = new Map<string, string>();
    useDeskStore({
      get: (key) => store.get(key) ?? null,
      set: (key, value) => {
        store.set(key, value);
      },
      remove: (key) => {
        store.delete(key);
      },
      keys: () => [...store.keys()],
    });
    const posted = emptyState({ ...DEFAULT_CONFIG, startingEquity: 50, walletSwaps: true, executionMode: "live" });
    posted.bot.running = true;
    const next = await adoptPostedBook("solana", "SoRunner", posted);
    assert.equal(next.bot.running, true);
    assert.equal(readLastWallet("solana"), "SoRunner");
    assert.ok(listLocalBooks("solana").includes("SoRunner"));
    useDeskStore(null);
    if (prior !== undefined) (globalThis as { window?: unknown }).window = prior;
  });
});
