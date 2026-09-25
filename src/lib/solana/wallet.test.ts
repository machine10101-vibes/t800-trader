import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { combineMintReads } from "./wallet";

describe("combineMintReads", () => {
  it("uses a positive balance and treats a total miss as unknown", () => {
    assert.equal(combineMintReads([1.5, 0]), 1.5);
    assert.equal(combineMintReads([0, null]), null);
    assert.equal(combineMintReads([0, 0]), 0);
    assert.equal(combineMintReads([null, null]), null);
  });
});
