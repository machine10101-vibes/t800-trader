import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { bookTokens } from "./market/universe";
import { landingMark, landingOrbit, landingTokens } from "./landing";

describe("landing roster", () => {
  it("puts every traded name on the ring once, with a local mark", () => {
    const tokens = landingTokens();
    assert.deepEqual(
      tokens.map((token) => token.symbol),
      [...bookTokens("solana"), ...bookTokens("cronos"), ...bookTokens("dash")].map((token) => token.symbol),
    );
    const orbit = landingOrbit();
    assert.equal(orbit.length, tokens.length);
    assert.equal(new Set(orbit.map((token) => token.symbol)).size, tokens.length);
    assert.equal(orbit[0]?.chain, "solana");
    assert.equal(orbit[1]?.chain, "cronos");
    assert.equal(orbit[2]?.chain, "dash");
    for (const token of tokens) {
      const mark = landingMark(token.symbol);
      assert.ok(mark, token.symbol);
      assert.match(mark, /^\/t800-trader\/logos\/tokens\//);
      const file = path.join(process.cwd(), "public", mark.replace(/^\/t800-trader\//, ""));
      assert.equal(existsSync(file), true, file);
    }
  });
});
