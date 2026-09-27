import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { SOL_MINT, USDC_MINT } from "../market/universe";
import { needsSponsoredClose, planLiveSwap, preflightLiveSwap, sellQtyAfterFeeReserve } from "./live";
import { SOL_FEE_RESERVE } from "./jupiter";

function dummySwapTxBase64(): string {
  const payer = Keypair.generate();
  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: new PublicKey(SOL_MINT),
        lamports: 1,
      }),
    ],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
}

const base = {
  executionMode: "live" as const,
  sessionArmed: true,
  killSwitch: false,
  send: true,
  leg: "buy" as const,
  signalSide: "long" as const,
  notionalUsd: 25,
  tokenQty: 0,
  usdc: 80,
  sol: 0.5,
  maxLiveNotionalUsd: 50,
  minSolForFees: 0.02,
};

describe("live preflight", () => {
  it("defaults to blocking paper, kill switch, shorts, and thin wallets", () => {
    assert.equal(preflightLiveSwap({ ...base, executionMode: "paper" }), "Not in LIVE mode");
    assert.match(preflightLiveSwap({ ...base, killSwitch: true }) ?? "", /Kill switch/);
    assert.match(preflightLiveSwap({ ...base, sessionArmed: false }) ?? "", /Re-confirm LIVE/);
    assert.match(preflightLiveSwap({ ...base, signalSide: "short" }) ?? "", /perps/);
    assert.match(preflightLiveSwap({ ...base, sol: 0.001 }) ?? "", /SOL for fees/);
    assert.match(preflightLiveSwap({ ...base, notionalUsd: 80 }) ?? "", /exceeds live max/);
    assert.match(preflightLiveSwap({ ...base, usdc: 10 }) ?? "", /Need 25.00 USDC/);
    assert.equal(preflightLiveSwap(base), null);
  });

  it("allows a dry-run plan without a live session", () => {
    assert.equal(preflightLiveSwap({ ...base, send: false, sessionArmed: false }), null);
  });

  it("requires a token balance before a live sell", () => {
    assert.match(
      preflightLiveSwap({ ...base, leg: "sell", tokenQty: 0, notionalUsd: 10 }) ?? "",
      /No token balance/,
    );
  });

  it("lets a close proceed when SOL is under Phantom's 0.005 fee buffer", () => {
    assert.equal(
      preflightLiveSwap({
        ...base,
        leg: "sell",
        tokenQty: 12,
        sol: 0.001,
        notionalUsd: 20,
        killSwitch: true,
      }),
      null,
    );
  });
});

describe("live dry-run plan", () => {
  it("quotes and builds a VersionedTransaction without signing", async () => {
    const orig = globalThis.fetch;
    const b64 = dummySwapTxBase64();
    let posted = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/quote")) {
        return new Response(
          JSON.stringify({
            inputMint: USDC_MINT,
            outputMint: SOL_MINT,
            inAmount: "10000000",
            outAmount: "80000000",
            otherAmountThreshold: "79200000",
            slippageBps: 100,
            routePlan: [{ percent: 100 }],
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/swap") && init?.method === "POST") {
        posted = true;
        const body = JSON.parse(String(init.body)) as { userPublicKey?: string };
        assert.equal(body.userPublicKey, "11111111111111111111111111111111");
        return new Response(JSON.stringify({ swapTransaction: b64, lastValidBlockHeight: 1 }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;
    try {
      const plan = await planLiveSwap({
        owner: "11111111111111111111111111111111",
        mint: SOL_MINT,
        leg: "buy",
        usdcAmount: 10,
        slippageBps: 100,
      });
      assert.equal(posted, true);
      assert.equal(plan.leg, "buy");
      assert.equal(plan.mode, "metis");
      assert.equal(plan.inUi, 10);
      assert.ok(plan.transaction.message);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("builds a fee-sponsored close when SOL is below 0.006 and does not ask Metis to bill the wallet", async () => {
    const orig = globalThis.fetch;
    const b64 = dummySwapTxBase64();
    const token = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
    let metis = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = typeof init?.body === "string" ? (JSON.parse(init.body) as { method?: string }).method : "";
      if (method === "getAccountInfo") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { value: { data: { parsed: { info: { decimals: 6 } } } } },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/ultra/v1/order")) {
        return new Response(
          JSON.stringify({
            requestId: "req-1",
            transaction: b64,
            gasless: true,
            inAmount: "1000000",
            outAmount: "25000000",
            inputMint: token,
            outputMint: USDC_MINT,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/swap")) metis = true;
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;
    try {
      assert.equal(needsSponsoredClose(0.001), true);
      assert.equal(needsSponsoredClose(0.02), false);
      assert.equal(sellQtyAfterFeeReserve(SOL_MINT, 1, 0.02), 0.02 - SOL_FEE_RESERVE);
      const plan = await planLiveSwap({
        owner: "11111111111111111111111111111111",
        mint: token,
        leg: "sell",
        tokenQty: 1,
        slippageBps: 100,
        solBalance: 0.001,
      });
      assert.equal(plan.mode, "ultra");
      assert.equal(plan.requestId, "req-1");
      assert.equal(metis, false);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
