import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Trade } from "@/lib/types";
import { executionLine, tradeTally, tradesForLog } from "./blotter";

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
  it("lists every open and close when the counter says seven and only three are exits", () => {
    const trades = [
      trade({ id: "c1" }),
      trade({ id: "c2", reason: "target", pnlUsd: 6, pnlPct: 4, note: "target exit from reclaim entry" }),
      trade({ id: "c3", reason: "manual", pnlUsd: 1, pnlPct: 0.4, note: "manual exit from fade entry" }),
      trade({ id: "o1", action: "open", reason: "breakout", pnlUsd: null, pnlPct: null, note: "thesis" }),
      trade({ id: "o2", action: "open", reason: "reclaim", pnlUsd: null, pnlPct: null, note: "thesis" }),
      trade({ id: "o3", action: "open", reason: "fade", pnlUsd: null, pnlPct: null, note: "thesis" }),
      trade({ id: "o4", action: "open", reason: "breakout", pnlUsd: null, pnlPct: null, note: "thesis" }),
    ];
    const listed = tradesForLog(trades);
    assert.equal(listed.length, 7);
    assert.equal(tradeTally(listed).total, 7);
    assert.equal(tradeTally(listed).closed, 3);
    assert.equal(tradeTally(listed).opened, 4);
    assert.equal(listed.filter((row) => row.action === "close").length, 3);
  });

  it("says what closed, for how much, and why", () => {
    const line = executionLine(trade());
    assert.equal(line.verb, "Closed");
    assert.equal(line.symbol, "JUP");
    assert.equal(line.side, "long");
    assert.equal(line.qty, 10);
    assert.equal(line.notionalUsd, 15);
    assert.equal(line.pnlUsd, -4.2);
    assert.equal(line.pnlPct, -2.8);
    assert.equal(line.why, "Stop loss · entered on a breakout");
  });

  it("names an open and a scale-out in plain language", () => {
    const opened = executionLine(trade({ action: "open", reason: "reclaim", pnlUsd: null, pnlPct: null, note: "thesis" }));
    assert.equal(opened.verb, "Opened");
    assert.equal(opened.why, "Opened on a reclaim");
    assert.equal(opened.pnlUsd, null);
    const scaled = executionLine(
      trade({
        reason: "target",
        pnlUsd: 3,
        pnlPct: 2,
        note: "Scale 50% at +2.00% — let the rest run. Wallet tx abcdefgh.",
      }),
    );
    assert.equal(scaled.verb, "Scaled out");
    assert.equal(scaled.why, "Scale 50% at +2.00% — let the rest run.");
  });
});
