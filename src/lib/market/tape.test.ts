import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Candle, TokenCandidate } from "../types";
import { assetCall, candleChangePct, foldCandles, tapeInCash, tapeRead, tickHeadline, tickPass, withCandleTape } from "./tape";

function bar(close: number, index: number): Candle {
  return { time: index * 60, open: close, high: close, low: close, close, volume: 1 };
}

describe("candle tape", () => {
  it("reads a close-to-close rise and drop across a window of bars", () => {
    const up = [1, 1, 1, 1.01].map(bar);
    const down = [1, 1.02, 1.01, 0.99].map(bar);
    assert.ok((candleChangePct(up, 3) ?? 0) > 0.9);
    assert.ok((candleChangePct(down, 3) ?? 0) < 0);
    assert.equal(candleChangePct(up, 12), null);
  });

  it("folds five 1-minute bars into one 5-minute bar", () => {
    const start = 1_700_003_100;
    const closes = [10, 14, 8, 11, 12, 13];
    const candles = closes.map((close, i) => ({
      time: start + i * 60,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 2,
    }));
    const folded = foldCandles(candles, 5);
    assert.equal(folded.length, 2);
    assert.equal(folded[0].time, start);
    assert.equal(folded[0].open, 10);
    assert.equal(folded[0].close, 12);
    assert.equal(folded[0].high, 15);
    assert.equal(folded[0].low, 7);
    assert.equal(folded[0].volume, 10);
    assert.equal(folded[1].open, 13);
    assert.equal(folded[1].close, 13);
  });

  it("stamps the 5-minute and 15-minute moves from 1-minute bars", () => {
    const candles = Array.from({ length: 16 }, (_, i) => bar(i === 15 ? 1.02 : 1, i));
    const candidate = {
      flows: {
        m5: { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 0 },
        m15: { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 0 },
        m30: { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 0 },
        h1: { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 4 },
        h6: { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 9 },
        h24: { buys: 1, sells: 1, buyers: 1, sellers: 1, volumeUsd: 1, priceChangePct: 3 },
      },
    } as TokenCandidate;
    const stamped = withCandleTape(candidate, candles);
    assert.ok(stamped.flows.m5.priceChangePct > 1.9);
    assert.ok(stamped.flows.m15.priceChangePct > 1.9);
    assert.equal(stamped.flows.h1.priceChangePct, 4);
    assert.equal(stamped.flows.h24.priceChangePct, 3);
  });

  it("keeps a red 15-minute tape in cash and lets a flat one take 5x or 10x", () => {
    assert.match(tapeRead("SOL", 0.2, -0.43, 1.1), /red at -0.43%.*stays in cash/);
    assert.match(tapeRead("ZBCN", 0, 0, 0.2), /flat at 0.00%.*5x or 10x/);
    assert.match(tapeRead("SOL", 0.4, 0.8, 1), /green at 0.80%.*long is eligible/);
    assert.match(tickPass("ZBCN", 0), /flat \(0.00%\), waiting on a 5m/);
    assert.match(tickPass("SOL", -0.4), /red \(-0.40%\), staying in cash/);
    assert.equal(tapeInCash(-0.4), true);
    assert.equal(tapeInCash(-0.3), true);
    assert.equal(tapeInCash(0), false);
    assert.equal(tapeInCash(0.09), false);
    assert.equal(tapeInCash(0.1), false);
  });

  it("names SOL and Zebec on every tick", () => {
    const blocked = ["ZBCN: 15m is flat (0.00%), staying in cash"];
    const signals = [{ symbol: "SOL", side: "long", reason: "reclaim", confidence: 68.2 }];
    assert.equal(assetCall("SOL", signals, blocked), "long reclaim 68");
    assert.match(assetCall("ZBCN", [], blocked), /flat \(0.00%\)/);
    assert.match(tickHeadline(2, signals, blocked, false), /Tick 2 · SOL long reclaim 68 · Zebec .*flat.* · arm to send/);
    assert.doesNotMatch(tickHeadline(2, signals, blocked, true), /arm to send/);
  });

  it("names CRO on a Cronos tick", () => {
    const blocked = ["CRO: 15m is red (-0.40%), staying in cash"];
    assert.match(tickHeadline(3, [], blocked, false, [{ symbol: "CRO", label: "CRO" }]), /Tick 3 · CRO .*red.* · arm to send/);
    assert.doesNotMatch(tickHeadline(3, [], blocked, true, [{ symbol: "CRO", label: "CRO" }]), /Zebec|SOL/);
  });
});
