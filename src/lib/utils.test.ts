import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchJson, firstSuccess, sleep } from "./utils";

describe("fetchJson", () => {
  it("still sends one request when retries is 0", async () => {
    let n = 0;
    const prior = globalThis.fetch;
    globalThis.fetch = (async () => {
      n += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
      const json = await fetchJson<{ ok: boolean }>("https://example.test/x", { retries: 0, timeoutMs: 1_000 });
      assert.equal(n, 1);
      assert.equal(json.ok, true);
    } finally {
      globalThis.fetch = prior;
    }
  });
});

describe("firstSuccess", () => {
  it("returns the first accepted value without waiting out slower misses", async () => {
    const value = await firstSuccess(
      [sleep(40).then(() => 0), sleep(5).then(() => 2), Promise.reject(new Error("down"))],
      (n) => n > 0,
    );
    assert.equal(value, 2);
  });

  it("returns null when every attempt misses", async () => {
    const value = await firstSuccess([Promise.resolve(null), Promise.resolve(0)], (n) => typeof n === "number" && n > 0);
    assert.equal(value, null);
  });
});
