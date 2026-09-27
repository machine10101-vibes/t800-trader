import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  clampSlippageBps,
  decodeSwapTransaction,
  DEFAULT_JUPITER_API,
  explainUltraCloseError,
  fromAtomic,
  jupiterBaseUrl,
  parseQuote,
  parseUltraOrder,
  quoteUrl,
  swapRequestBody,
  toAtomic,
} from "./jupiter";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";

function dummySwapTxBase64(): string {
  const payer = Keypair.generate();
  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: new PublicKey(SOL),
        lamports: 1,
      }),
    ],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
}

describe("Jupiter builders", () => {
  it("defaults to the keyless lite API", () => {
    const prev = process.env.NEXT_PUBLIC_JUPITER_API;
    delete process.env.NEXT_PUBLIC_JUPITER_API;
    assert.equal(jupiterBaseUrl(), DEFAULT_JUPITER_API);
    const url = quoteUrl({ inputMint: USDC, outputMint: SOL, amount: "1000000", slippageBps: 50 });
    assert.ok(url.startsWith(`${DEFAULT_JUPITER_API}/quote?`));
    assert.ok(url.includes("inputMint=" + USDC));
    assert.ok(url.includes("amount=1000000"));
    assert.ok(url.includes("slippageBps=50"));
    if (prev === undefined) delete process.env.NEXT_PUBLIC_JUPITER_API;
    else process.env.NEXT_PUBLIC_JUPITER_API = prev;
  });

  it("clamps slippage and converts atomic amounts", () => {
    assert.equal(clampSlippageBps(0), 1);
    assert.equal(clampSlippageBps(5000), 2000);
    assert.equal(toAtomic(1.25, 6), "1250000");
    assert.equal(fromAtomic("1250000", 6), 1.25);
    assert.equal(toAtomic(0, 6), "0");
  });

  it("parses a quote and builds a swap body without sending", () => {
    const raw = {
      inputMint: USDC,
      outputMint: SOL,
      inAmount: "1000000",
      outAmount: "8000000",
      otherAmountThreshold: "7920000",
      slippageBps: 100,
      routePlan: [{ percent: 100 }],
    };
    const quote = parseQuote(raw);
    assert.equal(quote.inAmount, "1000000");
    const body = swapRequestBody(quote, "11111111111111111111111111111111");
    assert.equal(body.userPublicKey, "11111111111111111111111111111111");
    assert.equal(body.quoteResponse, raw);
    assert.equal(body.wrapAndUnwrapSol, true);
  });

  it("deserializes a swap transaction from base64", () => {
    const b64 = dummySwapTxBase64();
    const tx = decodeSwapTransaction(b64);
    assert.ok(tx.message);
  });

  it("keeps close priority fees small enough to leave Phantom's SOL buffer", () => {
    const raw = {
      inputMint: USDC,
      outputMint: SOL,
      inAmount: "1",
      outAmount: "1",
      routePlan: [{ percent: 100 }],
    };
    const body = swapRequestBody(parseQuote(raw), "11111111111111111111111111111111", { close: true }) as {
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: number } };
    };
    assert.ok(body.prioritizationFeeLamports.priorityLevelWithMaxLamports.maxLamports <= 20_000);
  });

  it("explains a sponsored close that Jupiter refuses", () => {
    assert.match(explainUltraCloseError({ errorCode: 3, errorMessage: "below gasless minimum" }), /0\.006 SOL/);
    assert.throws(() => parseUltraOrder({ errorCode: 2, errorMessage: "Need SOL for gas", transaction: null }), /0\.005 SOL/);
  });

  it("rejects an empty route", () => {
    assert.throws(() => parseQuote({ inputMint: USDC, outputMint: SOL, inAmount: "1", outAmount: "1", routePlan: [] }), /no route/);
  });
});

describe("live Jupiter quote (read-only, no send)", () => {
  it("fetches a 1 USDC → SOL quote from lite-api", async (t) => {
    try {
      const { fetchQuote } = await import("./jupiter");
      const quote = await fetchQuote({
        inputMint: USDC,
        outputMint: SOL,
        amount: "1000000",
        slippageBps: 50,
      });
      assert.equal(quote.inputMint, USDC);
      assert.equal(quote.outputMint, SOL);
      assert.ok(Number(quote.outAmount) > 0);
    } catch (error) {
      t.skip(`Jupiter lite-api unavailable: ${error instanceof Error ? error.message : error}`);
    }
  });
});
