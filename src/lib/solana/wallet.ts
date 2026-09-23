import { Connection, PublicKey } from "@solana/web3.js";
import { USDC_MINT } from "@/lib/market/universe";
import { fetchJson, nullableNum } from "@/lib/utils";

const RPCS = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"];

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

function connection(url = RPCS[0]): Connection {
  return new Connection(url, "confirmed");
}

export async function readBalances(address: string): Promise<Omit<WalletSession, "provider">> {
  const pk = new PublicKey(address);
  let last: unknown;
  for (const url of RPCS) {
    try {
      return await readBalancesFrom(connection(url), pk);
    } catch (error) {
      last = error;
    }
  }
  throw last instanceof Error ? last : new Error("Solana RPC could not read this wallet");
}

async function readBalancesFrom(conn: Connection, pk: PublicKey): Promise<Omit<WalletSession, "provider">> {
  const [lamports, tokenAccs, solPriceUsd] = await Promise.all([
    conn.getBalance(pk, "confirmed"),
    conn.getParsedTokenAccountsByOwner(pk, { mint: new PublicKey(USDC_MINT) }),
    liveSolPrice(),
  ]);
  const sol = lamports / 1_000_000_000;
  const usdc = tokenAccs.value.reduce((sum, acc) => {
    const amt = acc.account.data.parsed?.info?.tokenAmount?.uiAmount;
    return sum + (typeof amt === "number" && Number.isFinite(amt) ? amt : 0);
  }, 0);
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
