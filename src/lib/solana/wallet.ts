import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { SOL_MINT, USDC_MINT } from "@/lib/market/universe";
import { fetchJson, nullableNum, sleep } from "@/lib/utils";

const DEFAULT_RPCS = ["https://solana.publicnode.com", "https://solana-rpc.publicnode.com"];
const RPC_TIMEOUT_MS = 10_000;

export function solanaRpcs(): string[] {
  const extra = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_SOLANA_RPC?.trim() : "";
  return extra ? [extra, ...DEFAULT_RPCS] : [...DEFAULT_RPCS];
}

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
  signAndSendTransaction?: (transaction: unknown) => Promise<{ signature: string } | string>;
  signTransaction?: (transaction: unknown) => Promise<unknown>;
  on?: (event: string, fn: (...args: unknown[]) => void) => void;
  off?: (event: string, fn: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, fn: (...args: unknown[]) => void) => void;
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

async function liveSolPrice(): Promise<number | null> {
  try {
    const json = await fetchJson<{ solana?: { usd?: number } }>(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { timeoutMs: 8_000, retries: 2 },
    );
    return nullableNum(json.solana?.usd);
  } catch {
    return null;
  }
}

interface RpcResult<T> {
  result?: T;
  error?: { message?: string };
}

export async function solanaRpc<T>(method: string, params: unknown[]): Promise<{ endpoint: string; result: T }> {
  let last: unknown;
  for (const url of solanaRpcs()) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        cache: "no-store",
        signal: ctrl.signal,
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const json = (await res.json()) as RpcResult<T>;
      if (!res.ok || json.error) {
        throw new Error(json.error?.message || `${res.status} ${res.statusText} from ${url}`);
      }
      if (json.result === undefined) throw new Error(`Empty RPC result from ${url}`);
      return { endpoint: url, result: json.result };
    } catch (error) {
      last = error instanceof Error && error.name === "AbortError" ? new Error(`RPC timeout from ${url}`) : error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw last instanceof Error ? last : new Error("Solana RPC could not read this wallet");
}

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function usdcAta(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), new PublicKey(USDC_MINT).toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
}

export function associatedUsdcAddress(owner: string): string {
  return usdcAta(new PublicKey(owner)).toBase58();
}

async function readUsdc(owner: PublicKey): Promise<number> {
  const ata = usdcAta(owner);
  const acc = await solanaRpc<{
    value?: {
      data?: { parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } } };
    } | null;
  }>("getAccountInfo", [ata.toBase58(), { encoding: "jsonParsed" }]);
  if (!acc.result.value) return 0;
  const amt = acc.result.value.data?.parsed?.info?.tokenAmount?.uiAmount;
  return typeof amt === "number" && Number.isFinite(amt) ? amt : 0;
}

export async function pingSolanaRpc(): Promise<{ endpoint: string; result: string }> {
  const { endpoint, result } = await solanaRpc<string>("getHealth", []);
  return { endpoint, result };
}

export async function readBalances(address: string): Promise<Omit<WalletSession, "provider">> {
  const pk = new PublicKey(address);
  const [lamports, usdc, solPriceUsd] = await Promise.all([
    solanaRpc<{ value: number }>("getBalance", [pk.toBase58()]),
    readUsdc(pk),
    liveSolPrice(),
  ]);
  const sol = lamports.result.value / 1_000_000_000;
  const equityUsd = usdc + (solPriceUsd !== null ? sol * solPriceUsd : 0);
  return { address: pk.toBase58(), sol, usdc, solPriceUsd, equityUsd };
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

export async function disconnectWallet(provider?: InjectedProvider | null): Promise<void> {
  try {
    await provider?.disconnect?.();
  } catch {
    // Wallet may already be closed.
  }
}

const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export async function readMintDecimals(mint: string): Promise<number> {
  if (mint === SOL_MINT) return 9;
  if (mint === USDC_MINT) return 6;
  const acc = await solanaRpc<{
    value?: { data?: { parsed?: { info?: { decimals?: number } } } } | null;
  }>("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const decimals = acc.result.value?.data?.parsed?.info?.decimals;
  if (typeof decimals === "number" && Number.isFinite(decimals)) return decimals;
  throw new Error(`Could not read decimals for mint ${mint}`);
}

export async function readTokenUiAmount(owner: string, mint: string): Promise<number> {
  if (mint === SOL_MINT) {
    const bal = await readBalances(owner);
    return bal.sol;
  }
  const pk = new PublicKey(owner);
  const programs = [TOKEN_PROGRAM.toBase58(), TOKEN_2022_PROGRAM];
  let total = 0;
  for (const programId of programs) {
    const acc = await solanaRpc<{
      value?: { account?: { data?: { parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } } } } }[];
    }>("getTokenAccountsByOwner", [pk.toBase58(), { mint, programId }, { encoding: "jsonParsed" }]);
    for (const row of acc.result.value ?? []) {
      const amt = row.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
      if (typeof amt === "number" && Number.isFinite(amt)) total += amt;
    }
  }
  return total;
}

function signatureFromWallet(result: { signature: string } | string): string {
  if (typeof result === "string" && result.length > 0) return result;
  if (typeof result === "object" && result && "signature" in result && result.signature) return result.signature;
  throw new Error("Wallet signed but did not return a transaction signature");
}

export async function signAndSendVersionedTx(
  provider: InjectedProvider,
  transaction: VersionedTransaction,
): Promise<string> {
  if (provider.signAndSendTransaction) {
    return signatureFromWallet(await provider.signAndSendTransaction(transaction));
  }
  if (!provider.signTransaction) {
    throw new Error("Wallet cannot sign a swap. Use Phantom or Solflare.");
  }
  const signed = (await provider.signTransaction(transaction)) as VersionedTransaction;
  const raw = Buffer.from(signed.serialize()).toString("base64");
  const sent = await solanaRpc<string>("sendRawTransaction", [raw, { encoding: "base64", skipPreflight: false }]);
  return sent.result;
}

export async function confirmSignature(signature: string, timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await solanaRpc<{
      value?: { confirmationStatus?: string; err?: unknown }[] | null;
    }>("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
    const status = res.result.value?.[0];
    if (status?.err) throw new Error(`Swap landed with an error: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
    await sleep(1_400);
  }
  throw new Error(`Swap not confirmed in time. Signature ${signature}`);
}
