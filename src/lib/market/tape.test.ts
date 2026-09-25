import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Candle, TokenCandidate } from "../types";
import { assetCall, candleChangePct, tapeRead, tickHeadline, tickPass, withCandleTape } from "./tape";

function bar(close: number, index: number): Candle {
  return { time: index * 300, open: close, high: close, low: close, close, volume: 1 };
}

describe("candle tape", () => {
  it("reads a 15-minute rise and a 15-minute drop off the 5-minute bars", () => {
    const up = [1, 1, 1, 1.01].map(bar);
    const down = [1, 1.02, 1.01, 0.99].map(bar);
    assert.ok((candleChangePct(up, 3) ?? 0) > 0.9);
    assert.ok((candleChangePct(down, 3) ?? 0) < 0);
    assert.equal(candleChangePct(up, 12), null);
  });

  it("stamps the chart's 15-minute move onto the pool tape", () => {
    const candles = [1, 1, 1, 1.02].map(bar);
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
    assert.ok(stamped.flows.m15.priceChangePct > 1.9);
    assert.equal(stamped.flows.h1.priceChangePct, 4);
    assert.equal(stamped.flows.h24.priceChangePct, 3);
  });

  it("keeps a red 15-minute tape in cash and names a green one as eligible", () => {
    assert.match(tapeRead("SOL", 0.2, -0.43, 1.1), /red at -0.43%.*stays in cash/);
    assert.match(tapeRead("ZBCN", 0, 0, 0.2), /flat at 0.00%.*until that window is green/);
    assert.match(tapeRead("SOL", 0.4, 0.8, 1), /green at 0.80%.*long is eligible/);
    assert.match(tickPass("ZBCN", 0), /flat \(0.00%\), staying in cash/);
    assert.match(tickPass("SOL", -0.4), /red \(-0.40%\), staying in cash/);
  });

  it("names SOL and Zebec on every tick", () => {
    const blocked = ["ZBCN: 15m is flat (0.00%), staying in cash"];
    const signals = [{ symbol: "SOL", side: "long", reason: "reclaim", confidence: 68.2 }];
    assert.equal(assetCall("SOL", signals, blocked), "long reclaim 68");
    assert.match(assetCall("ZBCN", [], blocked), /flat \(0.00%\)/);
    assert.match(tickHeadline(2, signals, blocked, false), /Tick 2 · SOL long reclaim 68 · Zebec .*flat.* · arm to send/);
    assert.doesNotMatch(tickHeadline(2, signals, blocked, true), /arm to send/);
  });
});
