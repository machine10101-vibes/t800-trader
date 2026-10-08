import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isDeskChain, runnerCronosSession, runnerProbeUrls, runnerWalletSession } from "./deskHost";

describe("desk host", () => {
  it("probes same-origin first and skips HTTP from HTTPS", () => {
    const prior = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: { location: { origin: string; protocol: string } } }).window = {
      location: { origin: "https://machine10101-vibes.github.io", protocol: "https:" },
    };
    assert.deepEqual(runnerProbeUrls("https://machine10101-vibes.github.io"), [
      "https://machine10101-vibes.github.io/api/desk/status",
    ]);
    (globalThis as { window?: { location: { origin: string; protocol: string } } }).window = {
      location: { origin: "http://localhost:3000", protocol: "http:" },
    };
    assert.deepEqual(runnerProbeUrls("http://localhost:3000"), [
      "http://localhost:3000/api/desk/status",
      "http://127.0.0.1:8787/api/desk/status",
    ]);
    if (prior !== undefined) (globalThis as { window?: unknown }).window = prior;
    else delete (globalThis as { window?: unknown }).window;
  });

  it("builds dummy sessions the runner can tick without a wallet popup", () => {
    assert.equal(isDeskChain("solana"), true);
    assert.equal(isDeskChain("keys"), false);
    const sol = runnerWalletSession("So1");
    assert.equal(sol.address, "So1");
    const cro = runnerCronosSession("0xabc");
    assert.equal(cro.address, "0xabc");
  });
});
