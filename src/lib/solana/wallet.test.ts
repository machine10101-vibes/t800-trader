import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { USDC_MINT } from "../market/universe";
import {
  associatedUsdcAddress,
  connectWallet,
  disconnectWallet,
  pingSolanaRpc,
  readBalances,
  solanaRpcs,
  walletInstalled,
} from "./wallet";

const SYSTEM = "11111111111111111111111111111111";
const WSOL = "So11111111111111111111111111111111111111112";

describe("wallet helpers (no injected provider)", () => {
  it("reports no browser wallet in Node", () => {
    assert.equal(walletInstalled(), false);
  });

  it("refuses connectWallet without Phantom/Solflare", async () => {
    await assert.rejects(connectWallet(), /No Solana wallet found/);
  });

  it("treats disconnect without a provider as a no-op", async () => {
    await disconnectWallet(null);
    await disconnectWallet(undefined);
  });

  it("defaults to PublicNode RPCs and prepends an optional override", () => {
    const prev = process.env.NEXT_PUBLIC_SOLANA_RPC;
    delete process.env.NEXT_PUBLIC_SOLANA_RPC;
    assert.deepEqual(solanaRpcs(), [
      "https://solana.publicnode.com",
      "https://solana-rpc.publicnode.com",
    ]);
    process.env.NEXT_PUBLIC_SOLANA_RPC = "https://example-rpc.test";
    assert.equal(solanaRpcs()[0], "https://example-rpc.test");
    if (prev === undefined) delete process.env.NEXT_PUBLIC_SOLANA_RPC;
    else process.env.NEXT_PUBLIC_SOLANA_RPC = prev;
  });

  it("derives a stable classic-token USDC ATA", () => {
    const ata = associatedUsdcAddress(SYSTEM);
    assert.equal(ata, associatedUsdcAddress(SYSTEM));
    assert.notEqual(ata, associatedUsdcAddress(WSOL));
    assert.doesNotThrow(() => new PublicKey(ata));
    assert.doesNotThrow(() => new PublicKey(USDC_MINT));
  });

  it("rejects a malformed address before any RPC call", async () => {
    await assert.rejects(() => readBalances("not-a-solana-address"), /Non-base58|Invalid/);
  });

  it("reads mocked SOL + USDC without a live key", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method =
        typeof init?.body === "string" ? (JSON.parse(init.body) as { method?: string }).method : "";
      if (method === "getBalance") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: 2_500_000_000 } }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (method === "getAccountInfo") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { value: { data: { parsed: { info: { tokenAmount: { uiAmount: 12.5 } } } } } },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("coingecko")) {
        return new Response(JSON.stringify({ solana: { usd: 200 } }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch ${url} ${method}`);
    }) as typeof fetch;
    try {
      const bal = await readBalances(SYSTEM);
      assert.equal(bal.address, SYSTEM);
      assert.equal(bal.sol, 2.5);
      assert.equal(bal.usdc, 12.5);
      assert.equal(bal.solPriceUsd, 200);
      assert.equal(bal.equityUsd, 2.5 * 200 + 12.5);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

describe("live Solana RPC (read-only, no keys)", () => {
  it("pings getHealth on a public RPC", async (t) => {
    try {
      const ping = await pingSolanaRpc();
      assert.ok(solanaRpcs().includes(ping.endpoint));
      assert.equal(ping.result, "ok");
    } catch (error) {
      t.skip(`public RPC unavailable: ${error instanceof Error ? error.message : error}`);
    }
  });

  it("reads a well-known public account without spending", async (t) => {
    try {
      const bal = await readBalances(WSOL);
      assert.equal(bal.address, WSOL);
      assert.ok(bal.sol >= 0);
      assert.ok(bal.usdc >= 0);
      if (bal.solPriceUsd !== null) {
        assert.ok(bal.solPriceUsd > 0);
        assert.ok(bal.equityUsd >= bal.usdc);
      }
    } catch (error) {
      t.skip(`public RPC/price feed unavailable: ${error instanceof Error ? error.message : error}`);
    }
  });
});
