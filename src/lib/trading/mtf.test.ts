import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { backCheck, deskEntrySignals, fourHourEntrySignals, frameEntrySignals, levelBlock } from "./mtf";
import type { Candle, TokenCandidate } from "../types";

function trend(n: number, step: number, start: number, sec: number, breakout = false): Candle[] {
  const out: Candle[] = [];
  let px = start;
  for (let i = 0; i < n; i++) {
    const prev = px;
    px = start * (1 + step * i) + Math.sin(i / 2.2) * 1.1;
    out.push({
      time: 1_700_000_000 + i * sec,
      open: prev,
      high: Math.max(prev, px) + 0.15,
      low: Math.min(prev, px) - 0.15,
      close: px,
      volume: 1000 + (i % 5) * 120,
    });
  }
  if (breakout) {
    const p2 = out[n - 2];
    out[n - 2] = { ...p2, close: p2.high - 0.02 };
    const last = out[n - 1];
    const hi = Math.max(...out.slice(-13, -1).map((c) => c.high));
    out[n - 1] = { ...last, close: hi + 0.3, high: hi + 0.32, low: last.open - 0.05, volume: 1800 };
  }
  return out;
}

const flow = { buys: 60, sells: 40, buyers: 30, sellers: 20, volumeUsd: 1, priceChangePct: 0.6 };
const token = {
  symbol: "SOL",
  mint: "sol",
  poolAddress: "pool",
  sector: "L1",
  watchlist: true,
  priceUsd: 105,
  flows: { m5: flow, m15: flow, m30: flow, h1: { ...flow, priceChangePct: 1 }, h6: flow, h24: flow },
} as unknown as TokenCandidate;
const ctx = { stance: "mixed" as const, fearGreed: 50, solChange: 0 };
const breakout15m = trend(120, 0.0003, 100, 900, true);

describe("15-minute entry with a 1-hour and 4-hour back-check", () => {
  it("lets a trade through only when neither higher frame points the other way and one agrees", () => {
    assert.equal(backCheck("long", "up", "up").ok, true);
    assert.equal(backCheck("long", "range", "up").ok, true);
    assert.equal(backCheck("long", "up", "range").ok, true);
    assert.match(backCheck("long", "up", "down").why, /4-hour trend is down/);
    assert.match(backCheck("long", "down", "up").why, /1-hour trend is down/);
    assert.match(backCheck("long", "range", "range").why, /both ranging/);
    assert.equal(backCheck("short", "down", "down").ok, true);
    assert.match(backCheck("short", "down", "up").why, /4-hour trend is up/);
  });

  it("names the chart that has not loaded instead of guessing", () => {
    const h = trend(180, 0.002, 60, 3600);
    assert.equal(frameEntrySignals(token, { m15: null, h1: h, h4: h }, 70, true, ctx).missing, "15-minute");
    assert.equal(frameEntrySignals(token, { m15: breakout15m, h1: h.slice(0, 10), h4: h }, 70, true, ctx).missing, "1-hour");
    assert.equal(frameEntrySignals(token, { m15: breakout15m, h1: h, h4: [] }, 70, true, ctx).missing, "4-hour");
  });

  it("takes a 15-minute breakout long when the 1-hour and 4-hour trends are up", () => {
    const up = trend(180, 0.002, 60, 14_400);
    const decision = frameEntrySignals(token, { m15: breakout15m, h1: trend(180, 0.002, 60, 3600), h4: up }, 70, true, ctx);
    assert.equal(decision.signals.length, 1);
    assert.equal(decision.signals[0].side, "long");
    assert.equal(decision.signals[0].setupFrame, "15m");
    assert.match(decision.signals[0].thesis, /^15-minute long breakout\. Back-check passed: 1-hour up, 4-hour up\./);
  });

  it("skips the same 15-minute long when the 4-hour trend is down", () => {
    const decision = frameEntrySignals(
      token,
      { m15: breakout15m, h1: trend(180, 0.002, 60, 3600), h4: trend(180, -0.002, 160, 14_400) },
      70,
      true,
      ctx,
    );
    assert.equal(decision.signals.length, 0);
    assert.match(decision.pass ?? "", /SOL: 15-minute long breakout, but the 4-hour trend is down, so it waits/);
  });

  it("ignores a 15-minute bar that is still printing", () => {
    const now = Date.now() / 1000;
    const start = Math.floor(now / 900) * 900 - 900 * 29;
    const forming: Candle[] = [];
    for (let i = 0; i < 30; i++) {
      forming.push({
        time: start + i * 900,
        open: 100,
        high: 100.2,
        low: 99.8,
        close: 100,
        volume: 1000,
      });
    }
    const higher = trend(180, 0.002, 60, 3600);
    const decision = frameEntrySignals(token, { m15: forming, h1: higher, h4: higher }, 70, true, ctx);
    assert.equal(decision.missing, "15-minute");
    assert.equal(decision.signals.length, 0);
  });

  it("says why the 15-minute chart has no setup instead of claiming the chart is missing", () => {
    const quiet: Candle[] = [];
    for (let i = 0; i < 120; i++) {
      quiet.push({
        time: 1_700_000_000 + i * 900,
        open: 100,
        high: 100.001,
        low: 99.999,
        close: 100,
        volume: 1000,
      });
    }
    const higher = trend(180, 0.002, 60, 3600);
    const decision = frameEntrySignals(token, { m15: quiet, h1: higher, h4: higher }, 70, true, ctx);
    assert.equal(decision.missing, null);
    assert.equal(decision.signals.length, 0);
    assert.match(decision.pass ?? "", /SOL: 15-minute chart is in, no setup yet \(/);
  });

  it("treats a short 4-hour tape as ranging so a new book name can still back-check the 1-hour", () => {
    const thinFour = trend(12, 0.002, 60, 14_400);
    const decision = frameEntrySignals(
      token,
      { m15: breakout15m, h1: trend(180, 0.002, 60, 3600), h4: thinFour },
      70,
      true,
      ctx,
    );
    assert.equal(decision.missing, null);
    assert.equal(decision.signals.length, 1);
    assert.match(decision.signals[0].thesis, /Back-check passed: 1-hour up, 4-hour ranging/);
  });

  it("holds a long that would run straight into 4-hour resistance", () => {
    const h4: Candle[] = [];
    for (let i = 0; i < 60; i++) {
      const top = i % 10 === 5;
      const c = top ? 110 : 100 + (i % 10) * 0.5;
      h4.push({ time: i * 14_400, open: c - 0.2, high: top ? 110.4 : c + 0.3, low: c - 0.5, close: c, volume: 1000 });
    }
    assert.match(levelBlock("long", 110.1, h4, 0.6) ?? "", /pressing into 4-hour resistance/);
    assert.equal(levelBlock("long", 101, h4, 0.6), null);
  });
});

describe("4-hour margin setups and spot vs margin mode", () => {
  const up4h = trend(180, 0.001, 60, 14_400, true);
  const up1h = trend(180, 0.002, 60, 3600);

  it("takes a solid 4-hour breakout and tags it as a 4-hour setup", () => {
    const decision = fourHourEntrySignals(token, { m15: breakout15m, h1: up1h, h4: up4h }, 70, true, ctx);
    assert.equal(decision.signals.length, 1);
    assert.equal(decision.signals[0].setupFrame, "4h");
    assert.equal(decision.signals[0].side, "long");
    assert.match(decision.signals[0].thesis, /^4-hour long breakout\. Solid 4-hour structure\./);
  });

  it("will not call a thin 4-hour tape a solid setup", () => {
    const thin = trend(12, 0.002, 60, 14_400, true);
    const decision = fourHourEntrySignals(token, { m15: breakout15m, h1: up1h, h4: thin }, 70, true, ctx);
    assert.equal(decision.signals.length, 0);
    assert.match(decision.pass ?? "", /no solid setup yet \(need more closed bars\)/);
  });

  it("skips every name but SOL in margin mode", () => {
    const ray = { ...token, symbol: "RAY", mint: "ray" } as TokenCandidate;
    const decision = deskEntrySignals(ray, { m15: breakout15m, h1: up1h, h4: up4h }, 70, true, ctx, {
      mode: "margin",
      marginOnFourHour: false,
    });
    assert.equal(decision.signals.length, 0);
    assert.match(decision.pass ?? "", /margin mode only trades SOL perps/);
  });

  it("uses the 4-hour setup when margin waits on that chart", () => {
    const decision = deskEntrySignals(token, { m15: breakout15m, h1: up1h, h4: up4h }, 70, true, ctx, {
      mode: "margin",
      marginOnFourHour: true,
    });
    assert.equal(decision.signals[0]?.setupFrame, "4h");
  });

  it("keeps a 15-minute fill as spot when both is on and the 4-hour has no setup", () => {
    const quiet4h = trend(180, 0.00001, 100, 14_400);
    const decision = deskEntrySignals(token, { m15: breakout15m, h1: up1h, h4: quiet4h }, 70, true, ctx, {
      mode: "both",
      marginOnFourHour: true,
    });
    assert.equal(decision.signals[0]?.setupFrame, "15m");
  });
});
