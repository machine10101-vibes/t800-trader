import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CRIMECAT_MINT, SOL_MINT, ULTCAT_MINT, WCRO_MINT, bookTokens } from "./universe";
import { tokenInitials, tokenLogoUrl } from "./logos";

describe("token logos", () => {
  it("maps every book token on Solana and Cronos to a logo", () => {
    for (const chain of ["solana", "cronos"] as const) {
      for (const token of bookTokens(chain)) {
        const url = tokenLogoUrl({ mint: token.mint, symbol: token.symbol, chain });
        assert.ok(url, `${chain} ${token.symbol} needs a logo`);
      }
    }
    assert.match(tokenLogoUrl({ mint: SOL_MINT, symbol: "SOL" }) ?? "", /solana/i);
    assert.match(tokenLogoUrl({ mint: WCRO_MINT, symbol: "CRO" }) ?? "", /cro/i);
    assert.ok(tokenLogoUrl({ mint: ULTCAT_MINT, symbol: "ULTCAT" }));
    assert.equal(tokenLogoUrl({ mint: CRIMECAT_MINT, symbol: "CRIMECAT" }), "/t800-trader/logos/crimecat.svg");
  });

  it("finds header coins by ticker when there is no mint", () => {
    assert.ok(tokenLogoUrl({ symbol: "BTC" }));
    assert.ok(tokenLogoUrl({ symbol: "ETH" }));
    assert.ok(tokenLogoUrl({ symbol: "SOL" }));
    assert.ok(tokenLogoUrl({ symbol: "CRO" }));
    assert.equal(tokenLogoUrl({ symbol: "NOPE" }), null);
    assert.equal(tokenInitials("CRO"), "CR");
    assert.equal(tokenInitials("SOL"), "SO");
    assert.equal(tokenInitials("W"), "W");
  });
});
