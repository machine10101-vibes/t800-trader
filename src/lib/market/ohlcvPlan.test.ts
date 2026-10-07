import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CANDLE_COOL_MS,
  CHART_BARS,
  CHART_CANDLE_MS,
  CORE_POOL_MS,
  geckoHourlyChartUrl,
  mintsToFetch,
  POOL_MISS_MS,
  poolsToCandle,
  POPULAR_CANDLE_MS,
} from "./ohlcvPlan";

const now = 1_000_000;

describe("mintsToFetch", () => {
  const book = [
    { mint: "sol", pinned: true },
    { mint: "zebec", pinned: true },
    { mint: "paid", pinned: false },
    { mint: "xmr", pinned: false },
    { mint: "stonk", pinned: false },
  ];

  it("reads the pinned book and one popular name when nothing is cached", () => {
    assert.deepEqual(mintsToFetch(book, new Map(), now, 1), ["sol", "zebec", "paid"]);
  });

  it("skips a fresh popular name and takes the next gap", () => {
    const snaps = new Map([["paid", { at: now - 1_000, ok: true }]]);
    assert.deepEqual(mintsToFetch(book, snaps, now, 1), ["sol", "zebec", "xmr"]);
  });

  it("leaves a fresh core pool alone and waits out a miss", () => {
    const snaps = new Map([
      ["sol", { at: now - 1_000, ok: true }],
      ["zebec", { at: now - CORE_POOL_MS, ok: true }],
      ["paid", { at: now - 1_000, ok: true }],
      ["xmr", { at: now - 1_000, ok: false }],
    ]);
    assert.deepEqual(mintsToFetch(book, snaps, now, 1), ["zebec", "stonk"]);
    snaps.set("stonk", { at: now - POOL_MISS_MS + 1, ok: false });
    assert.deepEqual(mintsToFetch(book, snaps, now, 1), ["zebec"]);
  });
});

describe("poolsToCandle", () => {
  const pools = [
    { address: "sol-pool", pinned: true },
    { address: "paid-pool", pinned: false },
    { address: "xmr-pool", pinned: false },
  ];

  it("fills gaps and skips a chart that is fresh or cooling down", () => {
    const fresh = new Map([["sol-pool", now - 1_000]]);
    const missed = new Map([["paid-pool", now - 1_000]]);
    assert.deepEqual(poolsToCandle(pools, fresh, missed, now, 2), ["xmr-pool"]);
  });

  it("refetches a popular chart after it goes stale and a cooled pool after the wait", () => {
    const fresh = new Map([["paid-pool", now - POPULAR_CANDLE_MS]]);
    const missed = new Map([["xmr-pool", now - CANDLE_COOL_MS]]);
    assert.deepEqual(poolsToCandle(pools, fresh, missed, now, 2), ["sol-pool", "paid-pool"]);
  });
});

describe("4-hour chart url", () => {
  it("asks the venue feed for native 4-hour bars instead of waiting on 1-minute candles", () => {
    const url = geckoHourlyChartUrl("solana", "POOL", "pools");
    assert.match(url, /\/networks\/solana\/pools\/POOL\/ohlcv\/hour\?aggregate=4/);
    assert.match(url, /currency=usd/);
    assert.match(url, new RegExp(`limit=${CHART_BARS}`));
    assert.match(geckoHourlyChartUrl("cro", "MINT", "tokens"), /\/tokens\/MINT\/ohlcv\/hour\?aggregate=4/);
    assert.equal(CHART_CANDLE_MS, 60_000);
  });
});
