import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { armLiveSession, disarmLiveSession, isLiveSessionArmed, resumeLiveSession } from "./live-session";

describe("live session", () => {
  it("survives a refresh through sessionStorage", () => {
    const store = new Map<string, string>();
    const fake = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    };
    (globalThis as { sessionStorage?: typeof fake }).sessionStorage = fake;
    disarmLiveSession();
    assert.equal(isLiveSessionArmed(), false);
    armLiveSession();
    assert.equal(isLiveSessionArmed(), true);
    assert.equal(store.get("t800-trader-live-session"), "1");
    resumeLiveSession();
    assert.equal(isLiveSessionArmed(), true);
    disarmLiveSession();
    assert.equal(isLiveSessionArmed(), false);
    assert.equal(store.has("t800-trader-live-session"), false);
  });
});
