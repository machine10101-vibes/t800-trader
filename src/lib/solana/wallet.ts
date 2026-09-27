import { PublicKey } from "@solana/web3.js";
import { liveSolPrice } from "@/lib/market/marks";
import { SOL_MINT, USDC_MINT } from "@/lib/market/universe";
import {
  beginPhantomConnect,
  browserPhantomStore,
  clearPhantomLink,
  loadPhantomLink,
  phantomLinkProvider,
  phantomQueryKeys,
  takePhantomHandoff,
  type PhantomLinkStore,
} from "@/lib/solana/phantomLink";

const RPCS = [
  "https://solana.publicnode.com",
  "https://solana-rpc.publicnode.com",
  "https://public.rpc.solanavibestation.com",
  "https://rpc.solanatracker.io/public",
];

export interface WalletSession {
  address: string;
  sol: number;
  usdc: number;
  solPriceUsd: number | null;
  equityUsd: number;
  provider: InjectedProvider;
}

export interface InjectedProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isConnected?: boolean;
  publicKey?: { toBase58(): string } | null;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toBase58(): string } }>;
  disconnect?: () => Promise<void>;
  on?: (event: string, fn: (...args: unknown[]) => void) => void;
  off?: (event: string, fn: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, fn: (...args: unknown[]) => void) => void;
  signAndSendTransaction?: (tx: unknown) => Promise<{ signature: string } | string>;
  signTransaction?: (tx: unknown) => Promise<{ serialize(): Uint8Array }>;
}

/**
 * `connect=1` asks the in-app page to prompt once.
 * `connect=2` means that prompt already opened, so a reload after unlock only resumes.
 */
export function resumeStage(pageUrl: string): 0 | 1 | 2 {
  try {
    const value = new URL(pageUrl).searchParams.get("connect");
    if (value === "2") return 2;
    if (value === "1") return 1;
    return 0;
  } catch {
    return 0;
  }
}

export function withResumeStage(pageUrl: string, stage: 1 | 2): string {
  const url = new URL(pageUrl);
  url.searchParams.set("connect", String(stage));
  return url.toString();
}

/** Phantom mobile has no extension. This opens the current page in its in-app browser, ready to finish connect. */
export function phantomBrowseUrl(pageUrl: string): string {
  const url = new URL(withResumeStage(pageUrl, 1));
  return `https://phantom.app/ul/browse/${encodeURIComponent(url.toString())}?ref=${encodeURIComponent(url.origin)}`;
}

export function isPhoneEnvironment(input: { userAgent: string; maxTouchPoints?: number }): boolean {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(input.userAgent)) return true;
  return /Macintosh/i.test(input.userAgent) && (input.maxTouchPoints ?? 0) > 1;
}

export class OpenPhantomApp extends Error {
  readonly browseUrl: string;
  constructor(browseUrl: string) {
    super("Open this page in the Phantom app, then tap Connect.");
    this.name = "OpenPhantomApp";
    this.browseUrl = browseUrl;
  }
}

export interface WalletConnectEnv {
  mobile: boolean;
  phantom?: InjectedProvider | null;
  solflare?: InjectedProvider | null;
  solana?: InjectedProvider | null;
  pageUrl: string;
  /** 1 = prompt once inside Phantom. 2 = unlock already started, so only resume. */
  resumeStage?: 0 | 1 | 2;
  /** This browser already finished a Phantom connect, so a refresh may resume. */
  trusted?: boolean;
  sleep?: (ms: number) => Promise<void>;
  waitForProvider?: (timeoutMs: number) => Promise<InjectedProvider | null>;
  markResume?: (stage: 1 | 2) => void;
  clearResume?: () => void;
  phantomStore?: PhantomLinkStore;
  assign?: (url: string) => void;
}

export function isOpenPhantomApp(error: unknown): error is OpenPhantomApp {
  if (error instanceof OpenPhantomApp) return true;
  if (!error || typeof error !== "object") return false;
  const branded = error as { name?: unknown; browseUrl?: unknown };
  return branded.name === "OpenPhantomApp" && typeof branded.browseUrl === "string";
}

/** Mobile page loads must not call connect() unless Phantom is already mid-approval or trusted. */
export function shouldResumeSilently(input: {
  mobile: boolean;
  resumeStage: 0 | 1 | 2;
  trusted: boolean;
  isConnected: boolean;
}): boolean {
  if (!input.mobile) return true;
  return input.resumeStage > 0 || input.trusted || input.isConnected;
}

function providerAddress(provider: InjectedProvider): string | null {
  try {
    const address = provider.publicKey?.toBase58();
    return address || null;
  } catch {
    return null;
  }
}

export function pickInjectedProvider(env: WalletConnectEnv): InjectedProvider | null {
  if (env.phantom?.connect) return env.phantom;
  if (env.solflare?.connect) return env.solflare;
  if (env.solana?.connect) return env.solana;
  return null;
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "";
}

function errorCode(error: unknown): number {
  if (error && typeof error === "object" && "code" in error) {
    const code = Number((error as { code?: unknown }).code);
    return Number.isFinite(code) ? code : NaN;
  }
  return NaN;
}

export function isUnexpectedWalletError(error: unknown): boolean {
  return /unexpected error/i.test(errorText(error)) || errorCode(error) === -32603;
}

/** A page-load connect() on Phantom's in-app browser rejects with "Unexpected error" and blocks the tap. */
export function shouldPromptOnLoad(input: { mobile: boolean; hasPublicKey: boolean }): boolean {
  return !input.mobile && !input.hasPublicKey;
}

export function walletConnectFailure(error: unknown, input: { mobile: boolean; insidePhantom: boolean }): string {
  const message = errorText(error);
  const code = errorCode(error);
  const rejected = code === 4001 || /user rejected|user denied|rejected the request/i.test(message);
  if (rejected && !/unexpected/i.test(message)) {
    return "The wallet closed the connect request. Tap Connect and approve it.";
  }
  if (isUnexpectedWalletError(error)) {
    if (input.mobile && !input.insidePhantom) return "Open this page in the Phantom app, then tap Connect.";
    return "Phantom could not open the connect sheet. Close any other wallet prompt, then tap Connect again.";
  }
  return message || "Wallet connect failed";
}

const PHANTOM_TRUST_KEY = "t800-phantom-trusted";

function readTrustedFlag(): boolean {
  try {
    return localStorage.getItem(PHANTOM_TRUST_KEY) === "1";
  } catch {
    return false;
  }
}

function stampResume(stage: 1 | 2): void {
  const url = new URL(window.location.href);
  url.searchParams.set("connect", String(stage));
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function waitForInjected(timeoutMs: number): Promise<InjectedProvider | null> {
  const found = () => {
    if (typeof window === "undefined") return null;
    return pickInjectedProvider(browserEnv());
  };
  if (found()?.connect) return Promise.resolve(found());
  return new Promise((resolve) => {
    const finish = () => {
      window.removeEventListener("phantom#initialized", finish);
      window.clearTimeout(timer);
      resolve(found());
    };
    const timer = window.setTimeout(finish, timeoutMs);
    window.addEventListener("phantom#initialized", finish, { once: true });
  });
}

function browserEnv(): WalletConnectEnv {
  const w = window as Window & {
    phantom?: { solana?: InjectedProvider };
    solflare?: InjectedProvider;
    solana?: InjectedProvider;
  };
  return {
    mobile: isPhoneEnvironment({
      userAgent: navigator.userAgent || "",
      maxTouchPoints: navigator.maxTouchPoints,
    }),
    phantom: w.phantom?.solana ?? null,
    solflare: w.solflare ?? null,
    solana: w.solana ?? null,
    pageUrl: window.location.href,
    resumeStage: resumeStage(window.location.href),
    trusted: readTrustedFlag(),
    waitForProvider: waitForInjected,
    markResume: stampResume,
    clearResume: clearResumeQuery,
    phantomStore: browserPhantomStore(),
  };
}

function stripPhantomQuery(): void {
  try {
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of phantomQueryKeys()) {
      if (!url.searchParams.has(key)) continue;
      url.searchParams.delete(key);
      changed = true;
    }
    if (!changed) return;
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // The session is already stored.
  }
}

function clearResumeQuery(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("connect")) return;
    url.searchParams.delete("connect");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // The connect screen stays usable without the query.
  }
}

/** Disconnect should not silently connect again on the next refresh. */
export function forgetPhantomApproval(): void {
  try {
    localStorage.removeItem(PHANTOM_TRUST_KEY);
  } catch {
    // Private mode can block storage.
  }
  clearPhantomLink(browserPhantomStore());
  clearResumeQuery();
}

/** A key Phantom already exposed. This never calls connect(). */
export function injectedSolanaAddress(): string | null {
  if (typeof window === "undefined") return null;
  const provider = pickInjectedProvider(browserEnv());
  return provider ? providerAddress(provider) : null;
}

/** The approval survived. Drop the one-shot query so the next load only resumes. */
export function notePhantomApproved(): void {
  try {
    localStorage.setItem(PHANTOM_TRUST_KEY, "1");
  } catch {
    // Private mode can block storage. The address is still in hand.
  }
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("connect")) return;
    url.searchParams.delete("connect");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // The session is already in memory for this page.
  }
}

function injected(): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  return pickInjectedProvider(browserEnv());
}

export function walletInstalled(): boolean {
  return Boolean(injected());
}

export function detectedWalletName(): string | null {
  const provider = injected();
  if (!provider) return null;
  if (provider.isPhantom) return "Phantom";
  if (provider.isSolflare) return "Solflare";
  return "Solana wallet";
}

interface RpcResult<T> {
  result?: T;
  error?: { message?: string };
}

const RPC_TIMEOUT_MS = 4_000;

export function isForbiddenRpc(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /access forbidden|\b403\b/i.test(message);
}

/** The official public RPC answers "Access forbidden" and must not cover a real failure. */
export function pickRpcError(errors: unknown[]): Error {
  const real = errors.find((error) => error && !isForbiddenRpc(error));
  if (real instanceof Error) return real;
  if (typeof real === "string" && real) return new Error(real);
  return new Error("Solana refused this browser. The bot is still armed — try disarm again.");
}

async function rpcOnce<T>(url: string, method: string, params: unknown[], signal: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    cache: "no-store",
    signal,
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as RpcResult<T>;
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `${res.status} ${res.statusText} from ${url}`);
  }
  if (json.result === undefined) throw new Error(`Empty RPC result from ${url}`);
  return json.result;
}

/** First healthy endpoint wins. A hung public RPC no longer blocks the next one. */
export async function solanaRpc<T>(method: string, params: unknown[]): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
  try {
    return await new Promise<T>((resolve, reject) => {
      let pending = RPCS.length;
      const errors: unknown[] = [];
      for (const url of RPCS) {
        rpcOnce<T>(url, method, params, ctrl.signal)
          .then((result) => {
            ctrl.abort();
            resolve(result);
          })
          .catch((error) => {
            errors.push(error);
            pending -= 1;
            if (pending === 0) reject(pickRpcError(errors));
          });
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

/** One endpoint at a time. A broadcast must not race, or three RPCs each try to land it. */
export async function broadcastTransaction(bytes: Uint8Array): Promise<string> {
  const raw = bytesToBase64(bytes);
  const errors: unknown[] = [];
  for (const url of RPCS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      return await rpcOnce<string>(
        url,
        "sendTransaction",
        [raw, { encoding: "base64", skipPreflight: false, maxRetries: 3 }],
        ctrl.signal,
      );
    } catch (error) {
      errors.push(error);
    } finally {
      clearTimeout(timer);
    }
  }
  throw pickRpcError(errors);
}

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function usdcAta(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), new PublicKey(USDC_MINT).toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
}

async function readUsdc(owner: PublicKey): Promise<number> {
  const ata = usdcAta(owner);
  const acc = await solanaRpc<{
    value?: {
      data?: { parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } } };
    } | null;
  }>("getAccountInfo", [ata.toBase58(), { encoding: "jsonParsed" }]);
  if (!acc.value) return 0;
  const amt = acc.value.data?.parsed?.info?.tokenAmount?.uiAmount;
  return typeof amt === "number" && Number.isFinite(amt) ? amt : 0;
}

export async function mintDecimals(mint: string): Promise<number> {
  if (mint === SOL_MINT) return 9;
  if (mint === USDC_MINT) return 6;
  const acc = await solanaRpc<{
    value?: { data?: { parsed?: { type?: string; info?: { decimals?: number } } } } | null;
  }>("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const decimals = acc.value?.data?.parsed?.info?.decimals;
  if (typeof decimals !== "number" || !Number.isFinite(decimals)) {
    throw new Error("Could not read token decimals for this mint");
  }
  return decimals;
}

export async function readBalances(address: string): Promise<Omit<WalletSession, "provider">> {
  const pk = new PublicKey(address);
  const [lamports, usdc, solPriceUsd] = await Promise.all([
    solanaRpc<{ value: number }>("getBalance", [pk.toBase58()]),
    readUsdc(pk),
    liveSolPrice(),
  ]);
  const sol = lamports.value / 1_000_000_000;
  const equityUsd = usdc + (solPriceUsd !== null ? sol * solPriceUsd : 0);
  return { address: pk.toBase58(), sol, usdc, solPriceUsd, equityUsd };
}

const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

function associated(owner: PublicKey, mint: PublicKey, program: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), program.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
}

/**
 * A positive read wins. Zero from every program means the key is flat.
 * A failed read with no positive balance is unknown, so the caller keeps the booked size.
 */
export function combineMintReads(amounts: Array<number | null>): number | null {
  let known = 0;
  let unknown = false;
  for (const amt of amounts) {
    if (amt === null) unknown = true;
    else known += amt;
  }
  if (known > 0) return known;
  if (unknown) return null;
  return 0;
}

async function readTokenUi(address: string): Promise<number | null> {
  try {
    const acc = await solanaRpc<{
      value?: {
        data?: { parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } } };
      } | null;
    }>("getAccountInfo", [address, { encoding: "jsonParsed" }]);
    if (!acc.value) return 0;
    const amt = acc.value.data?.parsed?.info?.tokenAmount?.uiAmount;
    return typeof amt === "number" && Number.isFinite(amt) ? amt : 0;
  } catch {
    return null;
  }
}

/** This mint on the trading key. Null when the lookup itself failed. */
export async function readMintBalance(owner: string, mint: string): Promise<number | null> {
  if (mint === SOL_MINT) {
    const live = await readBalances(owner);
    return live.sol;
  }
  const ownerPk = new PublicKey(owner);
  const mintPk = new PublicKey(mint);
  const amounts = await Promise.all(
    [TOKEN_PROGRAM, TOKEN_2022].map((program) => readTokenUi(associated(ownerPk, mintPk, program).toBase58())),
  );
  return combineMintReads(amounts);
}

const CONNECT_RETRY_MS = 350;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolves the wallet address without reading balances.
 * An explicit tap calls connect() with no options. Passing `{ onlyIfTrusted: false }`
 * is what Phantom's in-app browser rejects as "Unexpected error."
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The wallet did not answer. Tap Connect again.")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function pollProviderAddress(
  provider: InjectedProvider,
  sleep: (ms: number) => Promise<void>,
  attempts: number,
): Promise<string | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const address = providerAddress(provider);
    if (address) return address;
    await sleep(100);
  }
  return providerAddress(provider);
}

export async function requestWalletAddress(
  onlyIfTrusted: boolean,
  env: WalletConnectEnv,
): Promise<{ address: string; provider: InjectedProvider }> {
  const resumeStageNow = env.resumeStage ?? 0;
  const trusted = Boolean(env.trusted);
  const store = env.phantomStore ?? browserPhantomStore();
  let provider = pickInjectedProvider(env);
  if (!provider) {
    const saved = loadPhantomLink(store);
    if (saved) {
      const assign = env.assign ?? ((url: string) => window.location.assign(url));
      return { address: saved.address, provider: phantomLinkProvider(saved, env.pageUrl, store, assign) };
    }
  }
  if (!provider && onlyIfTrusted && env.waitForProvider && (resumeStageNow > 0 || trusted)) {
    provider = await env.waitForProvider(2_000);
  }
  const sleep = env.sleep ?? delay;
  if (!provider?.connect) {
    if (!onlyIfTrusted && env.mobile) throw new OpenPhantomApp(beginPhantomConnect(env.pageUrl, store));
    throw new Error("No Solana wallet found. Install Phantom or Solflare, then reload.");
  }

  const existing = providerAddress(provider);
  if (existing && (onlyIfTrusted || provider.isConnected !== false)) {
    return { address: existing, provider };
  }

  if (onlyIfTrusted) {
    const resume = shouldResumeSilently({
      mobile: env.mobile,
      resumeStage: resumeStageNow,
      trusted,
      isConnected: provider.isConnected === true,
    });
    if (!resume) throw new Error("Wallet is not connected.");
    // A page load must not call connect(). That call has no tap, Phantom answers
    // "Unexpected error", and the unlock reload lands on the connect screen again.
    if (env.mobile) {
      const revealed = await pollProviderAddress(provider, sleep, resumeStageNow === 2 ? 15 : 5);
      if (revealed) return { address: revealed, provider };
    }
    const silentAllowed = !env.mobile || resumeStageNow === 2 || provider.isConnected === true || trusted;
    if (!silentAllowed) throw new Error("Wallet is not connected.");
    try {
      const res = await withTimeout(provider.connect({ onlyIfTrusted: true }), 8_000);
      const address = res?.publicKey?.toBase58() || providerAddress(provider);
      if (address) return { address, provider };
    } catch (error) {
      if (!env.mobile) throw error instanceof Error ? error : new Error("Wallet is not connected.");
    }
    env.clearResume?.();
    const after = await pollProviderAddress(provider, sleep, 5);
    if (!after) throw new Error("Wallet is not connected.");
    return { address: after, provider };
  }

  const insidePhantom = Boolean(provider.isPhantom);
  if (env.mobile && insidePhantom) env.markResume?.(2);
  const prompt = async () => {
    const res = await withTimeout(provider.connect(), 45_000);
    return res?.publicKey?.toBase58() || providerAddress(provider);
  };

  try {
    const address = await prompt();
    if (!address) throw new Error("Wallet connected but did not return a public key.");
    return { address, provider };
  } catch (error) {
    if (!isUnexpectedWalletError(error)) {
      env.clearResume?.();
      throw new Error(walletConnectFailure(error, { mobile: env.mobile, insidePhantom }));
    }
    await sleep(CONNECT_RETRY_MS);
    try {
      const address = await prompt();
      if (!address) throw new Error("Wallet connected but did not return a public key.");
      return { address, provider };
    } catch (retryError) {
      env.clearResume?.();
      if (env.mobile && !insidePhantom && !provider.isSolflare) {
        throw new OpenPhantomApp(phantomBrowseUrl(env.pageUrl));
      }
      throw new Error(walletConnectFailure(retryError, { mobile: env.mobile, insidePhantom }));
    }
  }
}

let connectInflight: Promise<WalletSession> | null = null;

export async function connectWallet(onlyIfTrusted = false): Promise<WalletSession> {
  const previous = connectInflight;
  if (onlyIfTrusted && previous) return previous;
  const run = async () => {
    if (!onlyIfTrusted && previous) {
      try {
        await previous;
      } catch {
        // The page-load attempt missed. The tap still gets its own prompt.
      }
    }
    const env = browserEnv();
    const store = env.phantomStore ?? browserPhantomStore();
    const handoff = takePhantomHandoff(env.pageUrl, store);
    stripPhantomQuery();
    if (handoff.kind === "error") throw new Error(handoff.message);
    if (handoff.kind === "sign") {
      try {
        await broadcastTransaction(handoff.signed);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Phantom signed, but the transaction did not land.";
        try {
          sessionStorage.setItem("t800-phantom-sign-note", message);
        } catch {
          // The desk still opens on the connected wallet.
        }
      }
    }
    const { address, provider } = await requestWalletAddress(onlyIfTrusted, env);
    notePhantomApproved();
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const balances = await readBalances(address);
        return { ...balances, provider };
      } catch (error) {
        lastError = error;
        if (attempt < 2) await delay(400);
      }
    }
    const message = lastError instanceof Error ? lastError.message : "Could not read the wallet balance.";
    const returned = handoff.kind === "connect" || handoff.kind === "sign";
    const linkedWithoutInjection = Boolean(loadPhantomLink(store)) && !pickInjectedProvider(env);
    if (returned || linkedWithoutInjection) {
      const note = /still armed|access forbidden|\b403\b/i.test(message)
        ? "Phantom connected, but Solana refused the balance read from this browser. The desk is open — pull to refresh in a moment."
        : `Phantom connected, but the balance read failed. ${message}`;
      try {
        sessionStorage.setItem("t800-phantom-sign-note", note);
      } catch {
        // The desk still opens on the connected wallet.
      }
      return { address, sol: 0, usdc: 0, solPriceUsd: null, equityUsd: 0, provider };
    }
    if (/still armed|access forbidden|\b403\b/i.test(message)) {
      throw new Error("Phantom connected, but Solana refused the balance read from this browser. Tap Connect again in a moment.");
    }
    throw new Error(`The wallet connected, but the balance read failed. ${message}`);
  };
  const pending = run().finally(() => {
    if (connectInflight === pending) connectInflight = null;
  });
  connectInflight = pending;
  return pending;
}

export async function refreshWallet(session: WalletSession): Promise<WalletSession> {
  const balances = await readBalances(session.address);
  return { ...session, ...balances };
}

export function listenWallet(
  provider: InjectedProvider,
  handlers: {
    onDisconnect?: () => void;
    onAccountChanged?: (address: string | null) => void;
  },
): () => void {
  const disconnect = () => handlers.onDisconnect?.();
  const accountChanged = (key: unknown) => {
    const address =
      key && typeof key === "object" && "toBase58" in key && typeof key.toBase58 === "function"
        ? key.toBase58()
        : null;
    handlers.onAccountChanged?.(address);
  };
  provider.on?.("disconnect", disconnect);
  provider.on?.("accountChanged", accountChanged);
  return () => {
    provider.off?.("disconnect", disconnect);
    provider.off?.("accountChanged", accountChanged);
    provider.removeListener?.("disconnect", disconnect);
    provider.removeListener?.("accountChanged", accountChanged);
  };
}

export async function disconnectWallet(provider?: InjectedProvider | null): Promise<void> {
  try {
    await provider?.disconnect?.();
  } catch {
    // Wallet may already be closed.
  }
}
