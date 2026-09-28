import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Trade } from "@/lib/types";
import { executionLine, logHeadline, stillOpenIds, tradesForLog } from "./blotter";

function trade(over: Partial<Trade> = {}): Trade {
  return {
    id: "t",
    mint: "mint",
    symbol: "JUP",
    side: "long",
    action: "close",
    qty: 10,
    price: 1.5,
    pnlUsd: -4.2,
    pnlPct: -2.8,
    reason: "stop",
    at: "2026-09-28T01:00:00.000Z",
    note: "stop exit from breakout entry",
    ...over,
  };
}

describe("execution log", () => {
  it("does not call past buys open when the book is empty", () => {
    const trades = [
      trade({ id: "c1", at: "2026-09-28T01:03:00.000Z" }),
      trade({ id: "c2", at: "2026-09-28T01:04:00.000Z", reason: "target", pnlUsd: 6, pnlPct: 4, note: "target exit from reclaim entry" }),
      trade({ id: "c3", at: "2026-09-28T01:05:00.000Z", reason: "manual", pnlUsd: 1, pnlPct: 0.4, note: "manual exit from fade entry" }),
      trade({ id: "o1", at: "2026-09-28T01:00:00.000Z", action: "open", reason: "breakout", pnlUsd: null, pnlPct: null, note: "thesis" }),
      trade({ id: "o2", at: "2026-09-28T01:01:00.000Z", action: "open", reason: "reclaim", pnlUsd: null, pnlPct: null, note: "thesis" }),
      trade({ id: "o3", at: "2026-09-28T01:02:00.000Z", action: "open", reason: "fade", pnlUsd: null, pnlPct: null, note: "thesis" }),
      trade({ id: "o4", at: "2026-09-28T01:06:00.000Z", action: "open", reason: "breakout", pnlUsd: null, pnlPct: null, note: "thesis" }),
    ];
    assert.equal(tradesForLog(trades).length, 7);
    assert.equal(stillOpenIds(trades, []).size, 0);
    assert.equal(logHeadline(7, 0), "Nothing open right now · 7 records in the history");
    for (const row of trades.filter((item) => item.action === "open")) {
      assert.equal(executionLine(row, false).stillOpen, false);
      assert.equal(executionLine(row, false).verb, "Bought");
    }
  });

  it("marks only the buy that still has a position", () => {
    const trades = [
      trade({ id: "o1", at: "2026-09-28T01:00:00.000Z", action: "open", pnlUsd: null, pnlPct: null }),
      trade({ id: "c1", at: "2026-09-28T01:01:00.000Z" }),
      trade({ id: "o2", at: "2026-09-28T01:02:00.000Z", action: "open", pnlUsd: null, pnlPct: null }),
    ];
    const open = stillOpenIds(trades, [{ mint: "mint" }]);
    assert.deepEqual([...open], ["o2"]);
    assert.equal(executionLine(trades[2], open.has("o2")).stillOpen, true);
  });

  it("says what was sold, for how much, and why", () => {
    const line = executionLine(trade());
    assert.equal(line.verb, "Sold");
    assert.equal(line.symbol, "JUP");
    assert.equal(line.notionalUsd, 15);
    assert.equal(line.pnlUsd, -4.2);
    assert.equal(line.pnlPct, -2.8);
    assert.equal(line.why, "It fell to the loss limit. It was bought because the price broke higher");
    assert.equal(line.stillOpen, false);
  });

  it("names a buy and a partial sale in plain language", () => {
    const bought = executionLine(trade({ action: "open", reason: "reclaim", pnlUsd: null, pnlPct: null, note: "thesis" }));
    assert.equal(bought.verb, "Bought");
    assert.equal(bought.why, "Bought because the price recovered");
    const partial = executionLine(
      trade({
        reason: "target",
        pnlUsd: 3,
        pnlPct: 2,
        note: "Scale 50% at +2.00% — let the rest run. Wallet tx abcdefgh.",
      }),
    );
    assert.equal(partial.verb, "Sold part");
    assert.equal(partial.why, "Sold 50% and kept the rest");
  });
});
