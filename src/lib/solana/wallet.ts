import { PublicKey } from "@solana/web3.js";
import { liveSolPrice } from "@/lib/market/marks";
import { SOL_MINT, USDC_MINT } from "@/lib/market/universe";

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

/** Phantom mobile has no extension. This opens the current page in its in-app browser. */
export function phantomBrowseUrl(pageUrl: string): string {
  const url = new URL(pageUrl);
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
  sleep?: (ms: number) => Promise<void>;
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
  };
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
export async function requestWalletAddress(
  onlyIfTrusted: boolean,
  env: WalletConnectEnv,
): Promise<{ address: string; provider: InjectedProvider }> {
  const provider = pickInjectedProvider(env);
  const sleep = env.sleep ?? delay;
  if (!provider?.connect) {
    if (!onlyIfTrusted && env.mobile) throw new OpenPhantomApp(phantomBrowseUrl(env.pageUrl));
    throw new Error("No Solana wallet found. Install Phantom or Solflare, then reload.");
  }

  const existing = providerAddress(provider);
  if (existing && (onlyIfTrusted || provider.isConnected !== false)) {
    return { address: existing, provider };
  }

  if (onlyIfTrusted) {
    if (!shouldPromptOnLoad({ mobile: env.mobile, hasPublicKey: Boolean(existing) })) {
      throw new Error("Wallet is not connected.");
    }
    const res = await provider.connect({ onlyIfTrusted: true });
    const address = res?.publicKey?.toBase58() || providerAddress(provider);
    if (!address) throw new Error("Wallet is not connected.");
    return { address, provider };
  }

  const insidePhantom = Boolean(provider.isPhantom);
  const prompt = async () => {
    const res = await provider.connect();
    return res?.publicKey?.toBase58() || providerAddress(provider);
  };

  try {
    const address = await prompt();
    if (!address) throw new Error("Wallet connected but did not return a public key.");
    return { address, provider };
  } catch (error) {
    if (!isUnexpectedWalletError(error)) {
      throw new Error(walletConnectFailure(error, { mobile: env.mobile, insidePhantom }));
    }
    await sleep(CONNECT_RETRY_MS);
    try {
      const address = await prompt();
      if (!address) throw new Error("Wallet connected but did not return a public key.");
      return { address, provider };
    } catch (retryError) {
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
    const { address, provider } = await requestWalletAddress(onlyIfTrusted, browserEnv());
    try {
      const balances = await readBalances(address);
      return { ...balances, provider };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read the wallet balance.";
      if (/still armed|access forbidden|\b403\b/i.test(message)) {
        throw new Error("Phantom connected, but Solana refused the balance read from this browser. Tap Connect again in a moment.");
      }
      throw new Error(`The wallet connected, but the balance read failed. ${message}`);
    }
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
