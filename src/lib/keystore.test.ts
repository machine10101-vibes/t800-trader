import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectSignerSecrets,
  cronosSignerKey,
  readSecret,
  solanaSignerKey,
  useDeskKeys,
  writeSecret,
} from "./keystore";

describe("keystore", () => {
  it("names Solana and Cronos trading keys", () => {
    assert.equal(solanaSignerKey("So1"), "t800-trader-signer:So1");
    assert.equal(cronosSignerKey("0xABC"), "t800-trader-signer:cronos:0xabc");
  });

  it("uses the desk backend when there is no window", () => {
    const prior = (globalThis as { window?: unknown }).window;
    delete (globalThis as { window?: unknown }).window;
    const store = new Map<string, string>();
    useDeskKeys({
      get: (key) => store.get(key) ?? null,
      set: (key, value) => {
        store.set(key, value);
      },
    });
    writeSecret(solanaSignerKey("So1"), "[1]");
    writeSecret(cronosSignerKey("0xAb"), "0xdead");
    assert.equal(readSecret(solanaSignerKey("So1")), "[1]");
    assert.deepEqual(collectSignerSecrets("So1"), { "t800-trader-signer:So1": "[1]" });
    assert.deepEqual(collectSignerSecrets("0xAb"), { "t800-trader-signer:cronos:0xab": "0xdead" });
    useDeskKeys(null);
    if (prior !== undefined) (globalThis as { window?: unknown }).window = prior;
  });
});
