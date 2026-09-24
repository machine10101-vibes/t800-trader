import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { firstSuccess, sleep } from "./utils";

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
