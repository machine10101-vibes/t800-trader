import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { armLiveSession, disarmLiveSession, isLiveSessionArmed, resumeLiveSession } from "./live-session";

function fakeStorage() {
  const store = new Map<string, string>();
  return {
    store,
    api: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  };
}

describe("live session", () => {
  it("survives a refresh through sessionStorage and a later visit through localStorage", () => {
    const session = fakeStorage();
    const local = fakeStorage();
    (globalThis as { sessionStorage?: typeof session.api }).sessionStorage = session.api;
    (globalThis as { localStorage?: typeof local.api }).localStorage = local.api;
    disarmLiveSession();
    assert.equal(isLiveSessionArmed(), false);
    armLiveSession();
    assert.equal(isLiveSessionArmed(), true);
    assert.equal(session.store.get("t800-trader-live-session"), "1");
    assert.equal(local.store.get("t800-trader-live-session"), "1");
    resumeLiveSession();
    assert.equal(isLiveSessionArmed(), true);
    disarmLiveSession();
    assert.equal(isLiveSessionArmed(), false);
    assert.equal(session.store.has("t800-trader-live-session"), false);
    assert.equal(local.store.has("t800-trader-live-session"), false);
  });
});
