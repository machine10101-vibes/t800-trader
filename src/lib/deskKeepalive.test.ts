import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deskTickWorkerUrl } from "./deskKeepalive";

describe("desk keepalive", () => {
  it("resolves the metronome next to the desk page", () => {
    assert.equal(deskTickWorkerUrl("http://127.0.0.1:8787/t800-trader/"), "http://127.0.0.1:8787/t800-trader/desk-tick.js");
    assert.equal(deskTickWorkerUrl("https://machine10101-vibes.github.io/t800-trader"), "https://machine10101-vibes.github.io/t800-trader/desk-tick.js");
    assert.equal(
      deskTickWorkerUrl("https://machine10101-vibes.github.io/t800-trader/index.html"),
      "https://machine10101-vibes.github.io/t800-trader/desk-tick.js",
    );
  });
});
