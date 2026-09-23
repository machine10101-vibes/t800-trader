import { PublicKey } from "@solana/web3.js";
import { USDC_MINT } from "@/lib/market/universe";
import { fetchJson, nullableNum } from "@/lib/utils";

const RPCS = ["https://solana.publicnode.com", "https://solana-rpc.publicnode.com"];

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

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  let last: unknown;
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const json = (await res.json()) as RpcResult<T>;
      if (!res.ok || json.error) {
        throw new Error(json.error?.message || `${res.status} ${res.statusText} from ${url}`);
      }
      if (json.result === undefined) throw new Error(`Empty RPC result from ${url}`);
      return json.result;
    } catch (error) {
      last = error;
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

async function readUsdc(owner: PublicKey): Promise<number> {
  const ata = usdcAta(owner);
  const acc = await rpc<{
    value?: {
      data?: { parsed?: { info?: { tokenAmount?: { uiAmount?: number | null } } } };
    } | null;
  }>("getAccountInfo", [ata.toBase58(), { encoding: "jsonParsed" }]);
  if (!acc.value) return 0;
  const amt = acc.value.data?.parsed?.info?.tokenAmount?.uiAmount;
  return typeof amt === "number" && Number.isFinite(amt) ? amt : 0;
}

export async function readBalances(address: string): Promise<Omit<WalletSession, "provider">> {
  const pk = new PublicKey(address);
  const [lamports, usdc, solPriceUsd] = await Promise.all([
    rpc<{ value: number }>("getBalance", [pk.toBase58()]),
    readUsdc(pk),
    liveSolPrice(),
  ]);
  const sol = lamports.value / 1_000_000_000;
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
