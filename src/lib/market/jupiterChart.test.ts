import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SOL_MINT } from "./universe";
import { jupiterChartUrl, parseJupiterCandles } from "./jupiterChart";

describe("Jupiter 4-hour chart", () => {
  it("asks Jupiter for a long native 4-hour series", () => {
    const url = jupiterChartUrl(SOL_MINT, 1_700_000_000_000, 300);
    assert.match(url, new RegExp(`datapi\\.jup\\.ag/v2/charts/${SOL_MINT}`));
    assert.match(url, /interval=4_HOUR/);
    assert.match(url, /candles=300/);
    assert.match(url, /type=price/);
    assert.match(url, /quote=usd/);
    assert.match(url, /to=1700000000000/);
  });

  it("keeps real bars and drops an empty print", () => {
    const bars = parseJupiterCandles([
      { time: 20, open: 2, high: 3, low: 1, close: 2.5, volume: 10 },
      { time: 10, open: 1, high: 2, low: 0.5, close: 1.5, volume: 4 },
      { time: 30, open: 0, high: 1, low: 0, close: 1, volume: 1 },
    ]);
    assert.deepEqual(
      bars.map((bar) => bar.time),
      [10, 20],
    );
    assert.equal(bars[1]?.close, 2.5);
  });
});
