import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isDeskApiPath, nextTickWaitMs, runnerBookUrl, runnerStatusUrl, shouldBrowserTick } from "./runtime";

describe("desk runtime", () => {
  it("waits the scan interval and checks live tickets sooner", () => {
    assert.equal(nextTickWaitMs({ scanSeconds: 5 }), 5_000);
    assert.equal(nextTickWaitMs({ scanSeconds: 2 }), 4_000);
    assert.equal(nextTickWaitMs({ scanSeconds: 15, openLivePosition: true }), 4_000);
    assert.equal(nextTickWaitMs({ scanSeconds: 5, usedMs: 1_200 }), 3_800);
    assert.equal(nextTickWaitMs({ scanSeconds: 5, usedMs: 9_000 }), 1_000);
    assert.equal(shouldBrowserTick({ runnerHost: false, lastTickAt: null, scanSeconds: 5 }), true);
    assert.equal(
      shouldBrowserTick({
        runnerHost: true,
        lastTickAt: new Date(1_700_000_000_000).toISOString(),
        scanSeconds: 5,
        nowMs: 1_700_000_000_000 + 5_000,
      }),
      false,
    );
    assert.equal(
      shouldBrowserTick({
        runnerHost: true,
        lastTickAt: new Date(1_700_000_000_000).toISOString(),
        scanSeconds: 5,
        nowMs: 1_700_000_000_000 + 25_000,
      }),
      true,
    );
  });

  it("builds runner API paths", () => {
    assert.equal(runnerStatusUrl(), "/api/desk/status");
    assert.equal(runnerBookUrl("cronos", "http://127.0.0.1:8787"), "http://127.0.0.1:8787/api/desk/cronos");
    assert.equal(isDeskApiPath("/api/desk/status"), true);
    assert.equal(isDeskApiPath("/api/desk/solana"), true);
    assert.equal(isDeskApiPath("/api/desk/keys"), true);
    assert.equal(isDeskApiPath("/api/desk/ethereum"), false);
  });
});
