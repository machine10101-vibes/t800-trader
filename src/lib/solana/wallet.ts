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
  publicKey?: { toBase58(): string } | null;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toBase58(): string } }>;
  disconnect?: () => Promise<void>;
  on?: (event: string, fn: (...args: unknown[]) => void) => void;
  off?: (event: string, fn: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, fn: (...args: unknown[]) => void) => void;
  signAndSendTransaction?: (tx: unknown) => Promise<{ signature: string } | string>;
  signTransaction?: (tx: unknown) => Promise<{ serialize(): Uint8Array }>;
}

function injected(): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    phantom?: { solana?: InjectedProvider };
    solflare?: InjectedProvider;
    solana?: InjectedProvider;
  };
  return w.phantom?.solana || w.solflare || w.solana || null;
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

export async function connectWallet(onlyIfTrusted = false): Promise<WalletSession> {
  const provider = injected();
  if (!provider?.connect) {
    throw new Error("No Solana wallet found. Install Phantom or Solflare, then reload.");
  }
  const res = await provider.connect({ onlyIfTrusted });
  const address = res.publicKey?.toBase58() || provider.publicKey?.toBase58();
  if (!address) throw new Error("Wallet connected but did not return a public key.");
  const balances = await readBalances(address);
  return { ...balances, provider };
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
