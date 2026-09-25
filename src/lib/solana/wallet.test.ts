import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { combineMintReads, pickRpcError } from "./wallet";

describe("combineMintReads", () => {
  it("uses a positive balance and treats a total miss as unknown", () => {
    assert.equal(combineMintReads([1.5, 0]), 1.5);
    assert.equal(combineMintReads([0, null]), null);
    assert.equal(combineMintReads([0, 0]), 0);
    assert.equal(combineMintReads([null, null]), null);
  });
});

describe("pickRpcError", () => {
  it("keeps a real node error and does not report access forbidden when another node answered", () => {
    const chosen = pickRpcError([
      new Error("Access forbidden"),
      new Error("Blockhash not found"),
      new Error("403 Forbidden"),
    ]);
    assert.equal(chosen.message, "Blockhash not found");
  });

  it("says the bot is still armed when every node refuses the browser", () => {
    const chosen = pickRpcError([new Error("Access forbidden"), new Error("403 Forbidden")]);
    assert.match(chosen.message, /still armed/i);
    assert.doesNotMatch(chosen.message, /^Access forbidden$/);
  });
});
