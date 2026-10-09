import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cashDeskLabel, cashLegLine, cashLegs, deskCashLegs, formatCashAmount, formatCashUsd, nativeCashSymbol } from "./cashHoldings";

describe("cash holdings", () => {
  it("lists USDC and SOL on Solana, USDC and CRO on Cronos", () => {
    assert.equal(nativeCashSymbol("solana"), "SOL");
    assert.equal(nativeCashSymbol("cronos"), "CRO");
    const sol = cashLegs({ chain: "solana", usdc: 25, native: 0.5, nativePriceUsd: 100 });
    assert.deepEqual(
      sol.map((leg) => ({ symbol: leg.symbol, amount: leg.amount, usd: leg.usd })),
      [
        { symbol: "USDC", amount: 25, usd: 25 },
        { symbol: "SOL", amount: 0.5, usd: 50 },
      ],
    );
    const cro = cashLegs({ chain: "cronos", usdc: 25, native: 0.08, nativePriceUsd: 0.0625 });
    assert.equal(cro[0]?.symbol, "USDC");
    assert.equal(cro[1]?.symbol, "CRO");
    assert.ok(Math.abs((cro[1]?.usd ?? 0) - 0.005) < 1e-9);
  });

  it("keeps both tokens when one side is dust or empty", () => {
    const empty = cashLegs({ chain: "cronos", usdc: 0, native: 0, nativePriceUsd: 0.06 });
    assert.equal(empty.length, 2);
    assert.equal(empty[0]?.usd, 0);
    assert.equal(empty[1]?.amount, 0);
    const dust = cashLegs({ chain: "cronos", usdc: 25, native: 0.08, nativePriceUsd: 0.0625 });
    assert.equal(formatCashUsd(dust[1]!.usd), "$0.0050");
    assert.match(cashLegLine(dust[1]!), /CRO/);
    assert.match(cashLegLine(dust[1]!), /\$0\.0050/);
  });

  it("words USDC as dollars and the native as units", () => {
    assert.equal(formatCashAmount("USDC", 25), "$25.00");
    assert.equal(formatCashAmount("SOL", 0.1234), "0.1234 SOL");
    assert.equal(formatCashAmount("CRO", 0), "0 CRO");
    assert.equal(formatCashUsd(0.005), "$0.0050");
    assert.equal(cashLegLine({ symbol: "USDC", amount: 25, usd: 25 }), "$25.00");
  });

  it("prefers the trading key, then the wallet, then paper USDC", () => {
    const armed = deskCashLegs({
      chain: "solana",
      live: true,
      paperCashUsd: 50,
      nativePriceUsd: 100,
      trading: { usdc: 25, sol: 0.1 },
      wallet: { usdc: 9, sol: 2 },
    });
    assert.deepEqual(
      armed.map((leg) => leg.amount),
      [25, 0.1],
    );
    const wallet = deskCashLegs({
      chain: "cronos",
      live: false,
      paperCashUsd: 0,
      nativePriceUsd: 0.06,
      wallet: { usdc: 12, sol: 3, wcro: 1 },
    });
    assert.equal(wallet[0]?.amount, 12);
    assert.equal(wallet[1]?.symbol, "CRO");
    assert.equal(wallet[1]?.amount, 4);
    const paper = deskCashLegs({ chain: "solana", live: false, paperCashUsd: 50, nativePriceUsd: 100, wallet: { usdc: 9, sol: 2 } });
    assert.deepEqual(
      paper.map((leg) => ({ symbol: leg.symbol, amount: leg.amount })),
      [
        { symbol: "USDC", amount: 50 },
        { symbol: "SOL", amount: 0 },
      ],
    );
    const emptyPaperShowsWallet = deskCashLegs({
      chain: "solana",
      live: false,
      paperCashUsd: 0,
      nativePriceUsd: 100,
      wallet: { usdc: 9, sol: 2 },
      preferWallet: true,
    });
    assert.deepEqual(
      emptyPaperShowsWallet.map((leg) => leg.amount),
      [9, 2],
    );
  });

  it("labels practice, wallet, and trading cash", () => {
    assert.equal(cashDeskLabel(false, false), "Practice cash");
    assert.equal(cashDeskLabel(true, false), "Wallet cash");
    assert.equal(cashDeskLabel(true, true), "Trading cash");
  });
});
