import { fetchJson, nullableNum } from "@/lib/utils";
import { formatUnits } from "viem";
import { createPublicClient, erc20Abi, fallback, http } from "viem";
import { cronos } from "viem/chains";
import { CRONOS_CHAIN_ID, CRONOS_RPCS, USDC, WCRO } from "./constants";

export interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

export interface CronosSession {
  address: string;
  sol: number;
  usdc: number;
  solPriceUsd: number | null;
  equityUsd: number;
  provider: EthereumProvider;
}

const client = createPublicClient({
  chain: cronos,
  transport: fallback(CRONOS_RPCS.map((url) => http(url, { timeout: 8_000 }))),
});

export function cronosClient() {
  return client;
}

function injected(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { ethereum?: EthereumProvider };
  return w.ethereum ?? null;
}

export function cronosWalletInstalled(): boolean {
  return Boolean(injected());
}

export function detectedCronosWallet(): string | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    ethereum?: { isMetaMask?: boolean; isCryptoCom?: boolean; isDefiWallet?: boolean };
  };
  const eth = w.ethereum;
  if (!eth) return null;
  if (eth.isDefiWallet || eth.isCryptoCom) return "Crypto.com";
  if (eth.isMetaMask) return "MetaMask";
  return "Ethereum wallet";
}

export async function croPriceUsd(): Promise<number | null> {
  try {
    const json = await fetchJson<{
      data?: { attributes?: { token_prices?: Record<string, string> } };
    }>(`https://api.geckoterminal.com/api/v2/simple/networks/cro/token_price/${WCRO}`, {
      timeoutMs: 4_000,
      retries: 1,
    });
    const prices = json.data?.attributes?.token_prices ?? {};
    const raw = prices[WCRO] ?? prices[WCRO.toLowerCase()] ?? Object.values(prices)[0];
    return nullableNum(raw);
  } catch {
    return null;
  }
}

export async function readCronosBalances(address: string): Promise<Omit<CronosSession, "provider">> {
  const owner = address as `0x${string}`;
  const [native, usdcRaw, price] = await Promise.all([
    client.getBalance({ address: owner }),
    client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    croPriceUsd(),
  ]);
  const sol = Number(formatUnits(native, 18));
  const usdc = Number(formatUnits(usdcRaw, 6));
  const solPriceUsd = price && price > 0 ? price : null;
  const equityUsd = usdc + sol * (solPriceUsd ?? 0);
  return { address, sol, usdc, solPriceUsd, equityUsd };
}

export async function readWcroBalance(address: string): Promise<number> {
  const raw = await client.readContract({
    address: WCRO,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  });
  return Number(formatUnits(raw, 18));
}

function chainIsCronos(chainId: unknown): boolean {
  return chainId === CRONOS_CHAIN_ID || chainId === "0x019" || chainId === "25";
}

export async function ensureCronos(provider: EthereumProvider): Promise<void> {
  const current = await provider.request({ method: "eth_chainId" });
  if (chainIsCronos(current)) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CRONOS_CHAIN_ID }] });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? Number((error as { code?: number }).code) : 0;
    if (code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CRONOS_CHAIN_ID,
            chainName: "Cronos",
            nativeCurrency: { name: "Cronos", symbol: "CRO", decimals: 18 },
            rpcUrls: ["https://evm.cronos.org"],
            blockExplorerUrls: ["https://cronoscan.com"],
          },
        ],
      });
      return;
    }
    throw new Error("Switch the wallet to the Cronos network to trade CRO.");
  }
}

export async function connectCronos(onlyIfTrusted = false): Promise<CronosSession> {
  const provider = injected();
  if (!provider) throw new Error("No Cronos wallet found. Install MetaMask or the Crypto.com DeFi wallet, then reload.");
  const accounts = (await provider.request({
    method: onlyIfTrusted ? "eth_accounts" : "eth_requestAccounts",
  })) as string[];
  const address = accounts?.[0];
  if (!address) throw new Error(onlyIfTrusted ? "Wallet is not connected." : "Wallet connected but did not return an account.");
  if (!onlyIfTrusted) await ensureCronos(provider);
  else {
    const current = await provider.request({ method: "eth_chainId" });
    if (!chainIsCronos(current)) throw new Error("Wallet is not on Cronos.");
  }
  const balances = await readCronosBalances(address);
  return { ...balances, provider };
}

export async function refreshCronos(session: CronosSession): Promise<CronosSession> {
  const balances = await readCronosBalances(session.address);
  return { ...session, ...balances };
}

export function listenCronos(
  provider: EthereumProvider,
  handlers: {
    onDisconnect?: () => void;
    onAccountChanged?: (address: string | null) => void;
  },
): () => void {
  const accounts = (next: unknown) => {
    const list = Array.isArray(next) ? next : [];
    const address = typeof list[0] === "string" ? list[0] : null;
    handlers.onAccountChanged?.(address);
  };
  const disconnect = () => handlers.onDisconnect?.();
  provider.on?.("accountsChanged", accounts);
  provider.on?.("disconnect", disconnect);
  return () => {
    provider.removeListener?.("accountsChanged", accounts);
    provider.removeListener?.("disconnect", disconnect);
  };
}

export async function disconnectCronos(provider?: EthereumProvider | null): Promise<void> {
  try {
    await provider?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  } catch {
    // The wallet may not support revoke. The desk still drops the local session.
  }
}
