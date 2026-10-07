import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import {
  bookMints,
  bookPools,
  classifySector,
  headlineFor,
  isForeignOrWrapped,
  isQuote,
  isStable,
  SOL_MINT,
  USDC_MINT,
  USDT_MINT,
  WATCHLIST,
  watchMeta,
} from "./universe";

describe("Solana universe", () => {
  it("keeps official mint constants as valid public keys", () => {
    for (const mint of [SOL_MINT, USDC_MINT, USDT_MINT, ...WATCHLIST.map((t) => t.mint)]) {
      assert.doesNotThrow(() => new PublicKey(mint), mint);
    }
  });

  it("maps watchlist mints and classifies quotes", () => {
    assert.equal(watchMeta(SOL_MINT)?.symbol, "SOL");
    assert.equal(watchMeta(USDC_MINT), undefined);
    assert.equal(isStable("USDC"), true);
    assert.equal(isQuote("SOL"), true);
    assert.equal(isQuote("WSOL"), true);
    assert.equal(isQuote("BONK"), false);
    assert.equal(classifySector("JUP", "Jupiter"), "DEX");
    assert.equal(classifySector("BONK", "Bonk"), "Meme");
    assert.equal(isForeignOrWrapped("WETH", "Wrapped Ether"), true);
    assert.equal(isForeignOrWrapped("JUP", "Jupiter"), false);
  });

  it("trades CRO, ULTCAT, CRIMECAT, MERY, and PACK on Cronos", () => {
    const symbols = bookMints("cronos").map((mint) => watchMeta(mint, "cronos")?.symbol);
    assert.deepEqual(symbols, ["CRO", "ULTCAT", "CRIMECAT", "MERY", "PACK"]);
    assert.equal(bookPools("cronos").length, 5);
    assert.deepEqual(
      headlineFor("cronos").map((row) => row.symbol),
      ["CRO", "ULTCAT", "CRIMECAT", "MERY", "PACK"],
    );
    assert.equal(watchMeta("0x5b326376d34253fab935d3113698c335c7e61e85", "cronos")?.name, "Crime Cat");
    assert.equal(bookMints("solana").includes("0x5c7f8a570d578ed84e63fdfa7b1ee72deae1ae23"), false);
  });
});
