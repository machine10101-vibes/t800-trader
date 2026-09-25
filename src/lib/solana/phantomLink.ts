import nacl from "tweetnacl";
import bs58 from "bs58";
import type { InjectedProvider } from "@/lib/solana/wallet";

const PENDING_SECRET = "t800-phantom-dapp-secret";
const LINK_KEY = "t800-phantom-link";

const PHANTOM_PARAMS = ["phantom_encryption_public_key", "nonce", "data", "errorCode", "errorMessage", "phantom_return"];

export interface PhantomLinkStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface PhantomLinkRecord {
  address: string;
  session: string;
  shared: string;
  dappPublic: string;
  dappSecret: string;
}

function readStored(key: string): string | null {
  try {
    const local = localStorage.getItem(key);
    if (local) return local;
  } catch {
    // Private mode can block local storage. The tab copy may still be there.
  }
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  let saved = false;
  try {
    localStorage.setItem(key, value);
    saved = localStorage.getItem(key) === value;
  } catch {
    // The session copy covers this tab if the phone keeps it alive.
  }
  try {
    sessionStorage.setItem(key, value);
    saved = saved || sessionStorage.getItem(key) === value;
  } catch {
    // One of the two stores is enough.
  }
  if (!saved) throw new Error("This browser blocked wallet storage. Allow site data, then tap Connect again.");
}

function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // The session copy is removed below.
  }
  try {
    sessionStorage.removeItem(key);
  } catch {
    // The in-memory session still ends when the page closes.
  }
}

export function browserPhantomStore(): PhantomLinkStore {
  return {
    get: readStored,
    set: writeStored,
    remove: removeStored,
  };
}

export function clearPhantomLink(store: PhantomLinkStore): void {
  store.remove(PENDING_SECRET);
  store.remove(LINK_KEY);
}

export function loadPhantomLink(store: PhantomLinkStore): PhantomLinkRecord | null {
  const raw = store.get(LINK_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PhantomLinkRecord>;
    if (!parsed.address || !parsed.session || !parsed.shared || !parsed.dappPublic || !parsed.dappSecret) return null;
    return parsed as PhantomLinkRecord;
  } catch {
    return null;
  }
}

function normalizeDeskUrl(pageUrl: string): URL {
  const url = new URL(pageUrl);
  const last = url.pathname.split("/").pop() || "";
  if (!url.pathname.endsWith("/") && !last.includes(".")) url.pathname += "/";
  return url;
}

function cleanReturnUrl(pageUrl: string, kind: "connect" | "sign"): string {
  const url = normalizeDeskUrl(pageUrl);
  for (const key of PHANTOM_PARAMS) url.searchParams.delete(key);
  url.searchParams.delete("connect");
  url.hash = "";
  url.searchParams.set("phantom_return", kind);
  return url.toString();
}

function deskHome(pageUrl: string): string {
  const url = normalizeDeskUrl(pageUrl);
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** Phantom sometimes appends `?data=` onto a redirect that already has a query. */
function phantomParams(pageUrl: string): URLSearchParams {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return new URLSearchParams();
  }
  const merged = new URLSearchParams();
  const raw = `${url.search.replace(/^\?/, "")}&${url.hash.replace(/^#/, "")}`;
  for (const part of raw.split(/[&?]/)) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    let key = part.slice(0, eq);
    let value = part.slice(eq + 1);
    try {
      key = decodeURIComponent(key);
      value = decodeURIComponent(value.replace(/\+/g, "%2B"));
    } catch {
      // Keep the raw token. Base58 does not need further decoding.
    }
    if (!PHANTOM_PARAMS.includes(key) || !value || merged.has(key)) continue;
    merged.set(key, value);
  }
  return merged;
}

/** Opens Phantom and sends the public key back to this browser after the PIN. */
export function beginPhantomConnect(pageUrl: string, store: PhantomLinkStore): string {
  const pair = nacl.box.keyPair();
  store.set(PENDING_SECRET, bs58.encode(pair.secretKey));
  const params = new URLSearchParams({
    app_url: deskHome(pageUrl),
    dapp_encryption_public_key: bs58.encode(pair.publicKey),
    redirect_link: cleanReturnUrl(pageUrl, "connect"),
    cluster: "mainnet-beta",
  });
  return `https://phantom.app/ul/v1/connect?${params.toString()}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function base64ToBytes(value: string): Uint8Array {
  const text = atob(value);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

function decryptBox(data: string, nonce: string, phantomPublic: string, secret: Uint8Array): Record<string, unknown> {
  const shared = nacl.box.before(bs58.decode(phantomPublic), secret);
  const opened = nacl.box.open.after(bs58.decode(data), bs58.decode(nonce), shared);
  if (!opened) throw new Error("Phantom approved, but this browser could not read the wallet. Tap Connect again.");
  const parsed = JSON.parse(new TextDecoder().decode(opened)) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("Phantom approved, but this browser could not read the wallet. Tap Connect again.");
  return { ...(parsed as Record<string, unknown>), shared: bytesToBase64(shared) };
}

export type PhantomHandoff =
  | { kind: "none" }
  | { kind: "error"; message: string }
  | { kind: "connect"; address: string }
  | { kind: "sign"; signed: Uint8Array };

export function phantomQueryKeys(): string[] {
  return PHANTOM_PARAMS;
}

/** Reads Phantom's redirect, stores the session, and returns what the browser should do next. */
export function takePhantomHandoff(pageUrl: string, store: PhantomLinkStore): PhantomHandoff {
  let params: URLSearchParams;
  try {
    params = phantomParams(pageUrl);
  } catch {
    return { kind: "none" };
  }
  const errorCode = params.get("errorCode");
  if (errorCode) {
    store.remove(PENDING_SECRET);
    const message = params.get("errorMessage") || "";
    if (/reject|denied|cancel/i.test(message) || errorCode === "4001") {
      return { kind: "error", message: "Phantom closed the connect request. Tap Connect and approve it." };
    }
    return { kind: "error", message: message || "Phantom closed the connect request. Tap Connect and approve it." };
  }
  const data = params.get("data");
  const nonce = params.get("nonce");
  const phantomPublic = params.get("phantom_encryption_public_key");
  if (!data || !nonce || !phantomPublic) return { kind: "none" };

  const pending = store.get(PENDING_SECRET);
  const existing = loadPhantomLink(store);
  const secretB58 = pending || existing?.dappSecret;
  if (!secretB58) {
    return { kind: "error", message: "Phantom approved, but this browser forgot the secure handshake. Tap Connect again." };
  }
  let opened: Record<string, unknown>;
  try {
    opened = decryptBox(data, nonce, phantomPublic, bs58.decode(secretB58));
  } catch (error) {
    store.remove(PENDING_SECRET);
    const message = error instanceof Error ? error.message : "";
    return {
      kind: "error",
      message: message || "Phantom approved, but this browser could not read the wallet. Tap Connect again.",
    };
  }
  const shared = String(opened.shared || "");
  const kind = params.get("phantom_return");
  if (kind === "sign" || typeof opened.transaction === "string") {
    if (typeof opened.transaction !== "string") {
      return { kind: "error", message: "Phantom signed, but did not return the transaction. Tap Arm again." };
    }
    return { kind: "sign", signed: bs58.decode(opened.transaction) };
  }
  const address = typeof opened.public_key === "string" ? opened.public_key : "";
  const session = typeof opened.session === "string" ? opened.session : "";
  if (!address || !session) {
    return { kind: "error", message: "Phantom approved, but did not return a public key. Tap Connect again." };
  }
  const record: PhantomLinkRecord = {
    address,
    session,
    shared,
    dappPublic: bs58.encode(nacl.box.keyPair.fromSecretKey(bs58.decode(secretB58)).publicKey),
    dappSecret: secretB58,
  };
  store.set(LINK_KEY, JSON.stringify(record));
  store.remove(PENDING_SECRET);
  return { kind: "connect", address };
}

export function phantomSignUrl(tx: Uint8Array, pageUrl: string, store: PhantomLinkStore): string {
  const link = loadPhantomLink(store);
  if (!link) throw new Error("Connect Phantom again before signing.");
  const payload = new TextEncoder().encode(JSON.stringify({ session: link.session, transaction: bs58.encode(tx) }));
  const nonce = nacl.randomBytes(24);
  const encrypted = nacl.box.after(payload, nonce, base64ToBytes(link.shared));
  const params = new URLSearchParams({
    dapp_encryption_public_key: link.dappPublic,
    nonce: bs58.encode(nonce),
    redirect_link: cleanReturnUrl(pageUrl, "sign"),
    payload: bs58.encode(encrypted),
  });
  return `https://phantom.app/ul/v1/signTransaction?${params.toString()}`;
}

function serializeTx(tx: unknown): Uint8Array {
  if (!tx || typeof tx !== "object" || !("serialize" in tx) || typeof (tx as { serialize?: unknown }).serialize !== "function") {
    throw new Error("This wallet cannot sign a Solana transaction");
  }
  return (tx as { serialize: (opts?: { requireAllSignatures?: boolean; verifySignatures?: boolean }) => Uint8Array }).serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
}

/** A Phantom session that lives in this browser. Signing opens Phantom, then returns here. */
export function phantomLinkProvider(
  record: PhantomLinkRecord,
  pageUrl: string,
  store: PhantomLinkStore,
  assign: (url: string) => void,
): InjectedProvider {
  const redirect = (tx: unknown) => {
    assign(phantomSignUrl(serializeTx(tx), pageUrl, store));
    return new Promise<never>(() => {});
  };
  return {
    isPhantom: true,
    isConnected: true,
    publicKey: { toBase58: () => record.address },
    connect: async () => ({ publicKey: { toBase58: () => record.address } }),
    signAndSendTransaction: (tx) => redirect(tx),
    signTransaction: (tx) => redirect(tx).then(() => ({ serialize: () => new Uint8Array() })),
  };
}
