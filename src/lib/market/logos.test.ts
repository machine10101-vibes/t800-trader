import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CRIMECAT_MINT, CRONOS_USDC, SOL_MINT, ULTCAT_MINT, WCRO_MINT, bookTokens } from "./universe";
import { leadingTokenSymbol, tokenInitials, tokenLogoUrl, venueLogoUrl } from "./logos";

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
    assert.ok(tokenLogoUrl({ mint: CRONOS_USDC, symbol: "USDC" }));
    assert.ok(tokenLogoUrl({ symbol: "JITOSOL" }));
    assert.equal(tokenInitials("CRO"), "CR");
    assert.equal(tokenInitials("SOL"), "SO");
    assert.equal(tokenInitials("W"), "W");
  });

  it("pulls a known ticker off a status line", () => {
    assert.equal(leadingTokenSymbol("CRO is waiting for its profit goal at 0.12."), "CRO");
    assert.equal(leadingTokenSymbol("SOL: 4-hour chart has not loaded"), "SOL");
    assert.equal(leadingTokenSymbol("CRIMECAT limit bid at 0.001"), "CRIMECAT");
    assert.equal(leadingTokenSymbol("Emergency stop is on"), null);
  });

  it("maps every Settings DEX to its actual logo", () => {
    for (const id of ["raydium", "orca", "meteora", "jupiter", "pump", "wolfswap", "vvs", "crotrade"]) {
      const url = venueLogoUrl(id);
      assert.ok(url, `${id} needs a logo`);
      assert.match(url, /\/t800-trader\/logos\//);
    }
    assert.equal(venueLogoUrl("other"), null);
    assert.match(venueLogoUrl("wolfswap") ?? "", /wolfswap\.svg$/);
    assert.match(venueLogoUrl("vvs") ?? "", /vvs\.jpg$/);
    assert.match(venueLogoUrl("crotrade") ?? "", /crotrade\.png$/);
  });
});
