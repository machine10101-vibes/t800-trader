import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { closedCandles } from "./frames";
import type { Candle } from "@/lib/types";

function bar(time: number): Candle {
  return { time, open: 1, high: 1.1, low: 0.9, close: 1, volume: 10 };
}

describe("closedCandles", () => {
  it("drops the bar that is still printing", () => {
    const now = 1_700_000_450;
    const rows = [bar(1_700_000_000 - 900), bar(1_700_000_000)];
    const closed = closedCandles(rows, 900, now);
    assert.equal(closed.length, 1);
    assert.equal(closed[0]?.time, 1_700_000_000 - 900);
  });

  it("keeps a bar once its window has ended", () => {
    const now = 1_700_000_900;
    const rows = [bar(1_700_000_000 - 900), bar(1_700_000_000)];
    const closed = closedCandles(rows, 900, now);
    assert.equal(closed.length, 2);
    assert.equal(closed[1]?.time, 1_700_000_000);
  });
});
