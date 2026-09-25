import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OpenPhantomApp,
  combineMintReads,
  isPhoneEnvironment,
  isUnexpectedWalletError,
  phantomBrowseUrl,
  pickInjectedProvider,
  pickRpcError,
  requestWalletAddress,
  resumeStage,
  shouldPromptOnLoad,
  shouldResumeSilently,
  walletConnectFailure,
  type InjectedProvider,
  type WalletConnectEnv,
} from "./wallet";
import type { PhantomLinkStore } from "./phantomLink";

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

const PAGE = "https://machine10101-vibes.github.io/t800-trader/";
const KEY = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

function provider(opts?: {
  key?: string | null;
  isPhantom?: boolean;
  isSolflare?: boolean;
  isConnected?: boolean;
  connect?: (args?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toBase58(): string } }>;
}): { wallet: InjectedProvider; calls: Array<{ onlyIfTrusted?: boolean } | undefined> } {
  const calls: Array<{ onlyIfTrusted?: boolean } | undefined> = [];
  const wallet: InjectedProvider = {
    isPhantom: opts?.isPhantom,
    isSolflare: opts?.isSolflare,
    isConnected: opts?.isConnected,
    publicKey: opts?.key ? { toBase58: () => opts.key as string } : null,
    connect: async (args) => {
      calls.push(args);
      if (opts?.connect) return opts.connect(args);
      return { publicKey: { toBase58: () => opts?.key || KEY } };
    },
  };
  return { wallet, calls };
}

function env(partial: Partial<WalletConnectEnv> & { wallet?: InjectedProvider }): WalletConnectEnv {
  return {
    mobile: partial.mobile ?? false,
    phantom: partial.phantom ?? partial.wallet ?? null,
    solflare: partial.solflare ?? null,
    solana: partial.solana ?? null,
    pageUrl: partial.pageUrl ?? PAGE,
    resumeStage: partial.resumeStage,
    trusted: partial.trusted,
    sleep: partial.sleep ?? (async () => {}),
    waitForProvider: partial.waitForProvider,
    markResume: partial.markResume,
    clearResume: partial.clearResume,
    phantomStore: partial.phantomStore,
    assign: partial.assign,
  };
}

function memoryStore(): PhantomLinkStore {
  const values = new Map<string, string>();
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => values.set(key, value),
    remove: (key) => values.delete(key),
  };
}

describe("phantom mobile connect", () => {
  it("builds the in-app browse link for this desk", () => {
    const target = `${PAGE}?connect=1`;
    assert.equal(
      phantomBrowseUrl(PAGE),
      `https://phantom.app/ul/browse/${encodeURIComponent(target)}?ref=${encodeURIComponent("https://machine10101-vibes.github.io")}`,
    );
    assert.equal(resumeStage(`${PAGE}?connect=1`), 1);
    assert.equal(resumeStage(`${PAGE}?connect=2`), 2);
    assert.equal(resumeStage(PAGE), 0);
  });

  it("treats phones and touch-mac tablets as mobile", () => {
    assert.equal(isPhoneEnvironment({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)" }), true);
    assert.equal(isPhoneEnvironment({ userAgent: "Mozilla/5.0 (Linux; Android 14)" }), true);
    assert.equal(isPhoneEnvironment({ userAgent: "Mozilla/5.0 (Macintosh)", maxTouchPoints: 5 }), true);
    assert.equal(isPhoneEnvironment({ userAgent: "Mozilla/5.0 (Macintosh)", maxTouchPoints: 0 }), false);
  });

  it("does not call connect on load in a phone browser", () => {
    assert.equal(shouldPromptOnLoad({ mobile: true, hasPublicKey: false }), false);
    assert.equal(shouldPromptOnLoad({ mobile: false, hasPublicKey: false }), true);
    assert.equal(shouldPromptOnLoad({ mobile: false, hasPublicKey: true }), false);
  });

  it("prefers the Phantom injection over a conflicting window.solana", () => {
    const phantom = provider({ isPhantom: true }).wallet;
    const other = provider({ isPhantom: false }).wallet;
    assert.equal(pickInjectedProvider(env({ phantom, solana: other })), phantom);
  });

  it("reuses a key Phantom already exposed and does not prompt again", async () => {
    const { wallet, calls } = provider({ key: KEY, isPhantom: true, isConnected: true });
    const session = await requestWalletAddress(false, env({ mobile: true, wallet }));
    assert.equal(session.address, KEY);
    assert.equal(calls.length, 0);
  });

  it("skips the page-load prompt on a phone so the tap is not blocked", async () => {
    const { wallet, calls } = provider({ isPhantom: true });
    await assert.rejects(requestWalletAddress(true, env({ mobile: true, wallet })), /not connected/i);
    assert.equal(calls.length, 0);
  });

  it("calls connect with no options from an explicit tap", async () => {
    const { wallet, calls } = provider({ isPhantom: true });
    const session = await requestWalletAddress(false, env({ mobile: true, wallet }));
    assert.equal(session.address, KEY);
    assert.equal(calls.length, 1);
    assert.equal(calls[0], undefined);
  });

  it("still uses the trusted silent connect on a computer", async () => {
    const { wallet, calls } = provider({ isPhantom: true });
    await requestWalletAddress(true, env({ mobile: false, wallet }));
    assert.deepEqual(calls, [{ onlyIfTrusted: true }]);
  });

  it("retries a Phantom unexpected error once, then explains it", async () => {
    let attempt = 0;
    const { wallet, calls } = provider({
      isPhantom: true,
      connect: async () => {
        attempt += 1;
        if (attempt === 1) throw Object.assign(new Error("Unexpected error"), { code: 4001 });
        return { publicKey: { toBase58: () => KEY } };
      },
    });
    const session = await requestWalletAddress(false, env({ mobile: true, wallet }));
    assert.equal(session.address, KEY);
    assert.equal(calls.length, 2);
    assert.equal(isUnexpectedWalletError(Object.assign(new Error("Unexpected error."), { code: -32603 })), true);
  });

  it("says the connect sheet failed when Phantom keeps rejecting inside its own browser", async () => {
    const { wallet } = provider({
      isPhantom: true,
      connect: async () => {
        throw new Error("Unexpected error.");
      },
    });
    await assert.rejects(
      requestWalletAddress(false, env({ mobile: true, wallet })),
      /could not open the connect sheet/i,
    );
    assert.match(walletConnectFailure(new Error("User rejected the request."), { mobile: true, insidePhantom: true }), /approve it/i);
  });

  it("opens Phantom connect so the PIN returns to this browser", async () => {
    await assert.rejects(
      requestWalletAddress(false, env({ mobile: true, phantomStore: memoryStore() })),
      (error: unknown) => {
        assert.ok(error instanceof OpenPhantomApp);
        const url = new URL(error.browseUrl);
        assert.equal(url.origin + url.pathname, "https://phantom.app/ul/v1/connect");
        assert.ok(url.searchParams.get("dapp_encryption_public_key"));
        assert.match(url.searchParams.get("redirect_link") || "", /phantom_return=connect/);
        assert.equal(url.searchParams.get("cluster"), "mainnet-beta");
        return true;
      },
    );
  });

  it("keeps the install message on a computer with no wallet", async () => {
    await assert.rejects(requestWalletAddress(false, env({ mobile: false })), /Install Phantom or Solflare/);
  });

  it("resumes after unlock when Phantom reloads the page", async () => {
    const { wallet, calls } = provider({ isPhantom: true });
    const session = await requestWalletAddress(true, env({ mobile: true, wallet, resumeStage: 2 }));
    assert.equal(session.address, KEY);
    assert.deepEqual(calls, [{ onlyIfTrusted: true }]);
    assert.equal(shouldResumeSilently({ mobile: true, resumeStage: 2, trusted: false, isConnected: false }), true);
    assert.equal(shouldResumeSilently({ mobile: true, resumeStage: 0, trusted: false, isConnected: false }), false);
  });

  it("does not call connect from a page load inside Phantom", async () => {
    const marks: number[] = [];
    const { wallet, calls } = provider({ isPhantom: true });
    await assert.rejects(
      requestWalletAddress(
        true,
        env({
          mobile: true,
          wallet,
          resumeStage: 1,
          markResume: (stage) => marks.push(stage),
        }),
      ),
      /not connected/i,
    );
    assert.equal(calls.length, 0);
    assert.deepEqual(marks, []);
  });

  it("does not open a second sheet when the unlock reload is already resume-only", async () => {
    const { wallet, calls } = provider({
      isPhantom: true,
      connect: async () => {
        throw new Error("Unexpected error.");
      },
    });
    await assert.rejects(
      requestWalletAddress(true, env({ mobile: true, wallet, resumeStage: 2 })),
      /not connected/i,
    );
    assert.deepEqual(calls, [{ onlyIfTrusted: true }]);
  });

  it("remembers a trusted phone session and resumes it without a sheet", async () => {
    const { wallet, calls } = provider({ isPhantom: true });
    const session = await requestWalletAddress(true, env({ mobile: true, wallet, trusted: true }));
    assert.equal(session.address, KEY);
    assert.deepEqual(calls, [{ onlyIfTrusted: true }]);
  });

  it("stamps resume before the explicit Phantom tap so unlock can finish", async () => {
    const marks: number[] = [];
    const { wallet, calls } = provider({ isPhantom: true });
    await requestWalletAddress(
      false,
      env({
        mobile: true,
        wallet,
        markResume: (stage) => marks.push(stage),
      }),
    );
    assert.deepEqual(marks, [2]);
    assert.equal(calls[0], undefined);
  });
});
