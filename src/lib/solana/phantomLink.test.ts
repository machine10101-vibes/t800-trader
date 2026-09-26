import { describe, it } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  beginPhantomConnect,
  loadPhantomLink,
  phantomSignUrl,
  takePhantomHandoff,
  type PhantomLinkStore,
} from "./phantomLink";
import { requestWalletAddress, type WalletConnectEnv } from "./wallet";

const PAGE = "https://machine10101-vibes.github.io/t800-trader/";
const KEY = "11111111111111111111111111111111";

function memoryStore(): PhantomLinkStore {
  const values = new Map<string, string>();
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => values.set(key, value),
    remove: (key) => values.delete(key),
  };
}

function encrypt(payload: unknown, phantomSecret: Uint8Array, dappPublic: Uint8Array): { data: string; nonce: string; shared: Uint8Array } {
  const shared = nacl.box.before(dappPublic, phantomSecret);
  const nonce = nacl.randomBytes(24);
  const data = nacl.box.after(new TextEncoder().encode(JSON.stringify(payload)), nonce, shared);
  return { data: bs58.encode(data), nonce: bs58.encode(nonce), shared };
}

describe("phantom connect return", () => {
  it("sends the PIN approval back to this desk", () => {
    const store = memoryStore();
    const url = new URL(beginPhantomConnect(PAGE, store));
    assert.equal(url.origin + url.pathname, "https://phantom.app/ul/v1/connect");
    assert.match(url.searchParams.get("redirect_link") || "", /^https:\/\/machine10101-vibes\.github\.io\/t800-trader\/\?phantom_return=connect$/);
  });

  it("decrypts the public key Phantom returns after the PIN", () => {
    const store = memoryStore();
    const connectUrl = new URL(beginPhantomConnect(PAGE, store));
    const dappPublic = bs58.decode(connectUrl.searchParams.get("dapp_encryption_public_key") || "");
    const phantom = nacl.box.keyPair();
    const sealed = encrypt({ public_key: KEY, session: "sess-1" }, phantom.secretKey, dappPublic);
    const back = new URL(connectUrl.searchParams.get("redirect_link") || PAGE);
    back.searchParams.set("phantom_encryption_public_key", bs58.encode(phantom.publicKey));
    back.searchParams.set("nonce", sealed.nonce);
    back.searchParams.set("data", sealed.data);
    const handoff = takePhantomHandoff(back.toString(), store);
    assert.equal(handoff.kind, "connect");
    if (handoff.kind !== "connect") return;
    assert.equal(handoff.address, KEY);
    const saved = loadPhantomLink(store);
    assert.equal(saved?.address, KEY);
    assert.equal(saved?.session, "sess-1");
    assert.ok(saved?.shared);
    assert.equal(store.get("t800-phantom-dapp-secret"), null);
  });

  it("builds a sign link from the saved session", () => {
    const store = memoryStore();
    const connectUrl = new URL(beginPhantomConnect(PAGE, store));
    const dappPublic = bs58.decode(connectUrl.searchParams.get("dapp_encryption_public_key") || "");
    const phantom = nacl.box.keyPair();
    const sealed = encrypt({ public_key: KEY, session: "sess-1" }, phantom.secretKey, dappPublic);
    const back = new URL(PAGE);
    back.searchParams.set("phantom_return", "connect");
    back.searchParams.set("phantom_encryption_public_key", bs58.encode(phantom.publicKey));
    back.searchParams.set("nonce", sealed.nonce);
    back.searchParams.set("data", sealed.data);
    takePhantomHandoff(back.toString(), store);
    const sign = new URL(phantomSignUrl(new Uint8Array([1, 2, 3]), PAGE, store));
    assert.equal(sign.pathname, "/ul/v1/signTransaction");
    assert.equal(sign.searchParams.get("dapp_encryption_public_key"), connectUrl.searchParams.get("dapp_encryption_public_key"));
    assert.match(sign.searchParams.get("redirect_link") || "", /phantom_return=sign/);
  });

  it("reads the key when Phantom appends a second question mark", () => {
    const store = memoryStore();
    const connectUrl = new URL(beginPhantomConnect(PAGE, store));
    const dappPublic = bs58.decode(connectUrl.searchParams.get("dapp_encryption_public_key") || "");
    const phantom = nacl.box.keyPair();
    const sealed = encrypt({ public_key: KEY, session: "sess-1" }, phantom.secretKey, dappPublic);
    const redirect = connectUrl.searchParams.get("redirect_link") || PAGE;
    const broken = `${redirect}?phantom_encryption_public_key=${encodeURIComponent(bs58.encode(phantom.publicKey))}&nonce=${encodeURIComponent(sealed.nonce)}&data=${encodeURIComponent(sealed.data)}`;
    const handoff = takePhantomHandoff(broken, store);
    assert.equal(handoff.kind, "connect");
    if (handoff.kind !== "connect") return;
    assert.equal(handoff.address, KEY);
  });

  it("opens the desk from the saved key without calling connect again", async () => {
    const store = memoryStore();
    const connectUrl = new URL(beginPhantomConnect(PAGE, store));
    const dappPublic = bs58.decode(connectUrl.searchParams.get("dapp_encryption_public_key") || "");
    const phantom = nacl.box.keyPair();
    const sealed = encrypt({ public_key: KEY, session: "sess-1" }, phantom.secretKey, dappPublic);
    const back = new URL(connectUrl.searchParams.get("redirect_link") || PAGE);
    back.searchParams.set("phantom_encryption_public_key", bs58.encode(phantom.publicKey));
    back.searchParams.set("nonce", sealed.nonce);
    back.searchParams.set("data", sealed.data);
    assert.equal(takePhantomHandoff(back.toString(), store).kind, "connect");
    const env: WalletConnectEnv = {
      mobile: true,
      pageUrl: PAGE,
      phantomStore: store,
      sleep: async () => {},
    };
    const session = await requestWalletAddress(true, env);
    assert.equal(session.address, KEY);
    assert.equal(session.provider.isConnected, true);
  });

  it("says when Phantom closes the request", () => {
    const back = new URL(PAGE);
    back.searchParams.set("errorCode", "4001");
    back.searchParams.set("errorMessage", "User rejected the request");
    const handoff = takePhantomHandoff(back.toString(), memoryStore());
    assert.equal(handoff.kind, "error");
    if (handoff.kind !== "error") return;
    assert.match(handoff.message, /approve it/i);
  });
});
