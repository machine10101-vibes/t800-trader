import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAlreadyFlat, reentryBlocked, reentryHold } from "./close";

describe("hand close", () => {
  it("blocks the same mint until the hold expires", () => {
    const now = Date.parse("2026-09-25T00:00:00.000Z");
    const hold = reentryHold("mint-sol", now);
    assert.equal(reentryBlocked(hold, "mint-sol", now + 1_000), true);
    assert.equal(reentryBlocked(hold, "mint-zbcn", now + 1_000), false);
    assert.equal(reentryBlocked(hold, "mint-sol", now + 3 * 60_000), false);
    assert.equal(reentryBlocked(null, "mint-sol", now), false);
  });

  it("only treats an explicit already-flat close as a book cleanup", () => {
    assert.equal(isAlreadyFlat("ALREADY_FLAT: trading key does not hold this token"), true);
    assert.equal(isAlreadyFlat("Jupiter could not simulate this swap"), false);
  });
});
