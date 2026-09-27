import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import {
  classifySector,
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
});
