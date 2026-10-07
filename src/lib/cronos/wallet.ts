import { fetchJson, nullableNum } from "@/lib/utils";
import { formatUnits } from "viem";
import { createPublicClient, erc20Abi, fallback, http } from "viem";
import { cronos } from "viem/chains";
import { chainIsCronos, mergeNativeBalance, orderCronosAccounts, preferFundedAccount } from "./balance";
import { CRONOS_CHAIN_ID, CRONOS_RPCS, USDC, WCRO } from "./constants";
import { labelCronosProvider, pickCronosProvider, type CronosInjected, type CronosInjectedWindow } from "./provider";

export interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

export interface CronosSession {
  address: string;
  /** Native CRO. Gas is paid from this, not from wrapped CRO. */
  sol: number;
  /** Wrapped CRO. The wallet balance is native plus this. */
  wcro: number;
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

function readInjected(): CronosInjectedWindow | null {
  if (typeof window === "undefined") return null;
  return window as unknown as CronosInjectedWindow;
}

function injected(): CronosInjected | null {
  return pickCronosProvider(readInjected());
}

export function currentCronosProvider(): CronosInjected | null {
  return injected();
}

export function cronosWalletInstalled(): boolean {
  return Boolean(injected());
}

export function detectedCronosWallet(): string | null {
  return labelCronosProvider(injected());
}

let lastCroPrice: number | null = null;

export async function croPriceUsd(): Promise<number | null> {
  const gecko = async (): Promise<number | null> => {
    const json = await fetchJson<{
      data?: { attributes?: { token_prices?: Record<string, string> } };
    }>(`https://api.geckoterminal.com/api/v2/simple/networks/cro/token_price/${WCRO}`, {
      timeoutMs: 4_000,
      retries: 1,
    });
    const prices = json.data?.attributes?.token_prices ?? {};
    const raw = prices[WCRO] ?? prices[WCRO.toLowerCase()] ?? Object.values(prices)[0];
    return nullableNum(raw);
  };
  const llama = async (): Promise<number | null> => {
    const json = await fetchJson<{ coins?: Record<string, { price?: number }> }>(
      `https://coins.llama.fi/prices/current/cronos:${WCRO}`,
      { timeoutMs: 4_000, retries: 1 },
    );
    return nullableNum(json.coins?.[`cronos:${WCRO}`]?.price);
  };
  const coinGecko = async (): Promise<number | null> => {
    const json = await fetchJson<Record<string, { usd?: number }>>(
      "https://api.coingecko.com/api/v3/simple/price?ids=crypto-com-chain&vs_currencies=usd",
      { timeoutMs: 4_000, retries: 1 },
    );
    return nullableNum(json["crypto-com-chain"]?.usd);
  };
  for (const read of [gecko, llama, coinGecko]) {
    try {
      const price = await read();
      if (price && price > 0) {
        lastCroPrice = price;
        return price;
      }
    } catch {
      // The next quote is the backup. A miss keeps the last good price.
    }
  }
  return lastCroPrice;
}

function parseWei(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

async function providerNative(provider: EthereumProvider, owner: `0x${string}`): Promise<number | null> {
  try {
    const chainId = await provider.request({ method: "eth_chainId" });
    if (!chainIsCronos(chainId)) return null;
    const hex = await provider.request({ method: "eth_getBalance", params: [owner, "latest"] });
    const wei = parseWei(hex);
    if (wei == null || wei < 0n) return null;
    return Number(formatUnits(wei, 18));
  } catch {
    return null;
  }
}

export async function readCronosBalances(
  address: string,
  provider?: EthereumProvider | null,
): Promise<Omit<CronosSession, "provider">> {
  const owner = address as `0x${string}`;
  const [nativeRpc, nativeWallet, wcroRaw, usdcRaw, price] = await Promise.all([
    client.getBalance({ address: owner }).then(
      (wei) => Number(formatUnits(wei, 18)),
      () => null,
    ),
    provider ? providerNative(provider, owner) : Promise.resolve(null),
    client
      .readContract({ address: WCRO, abi: erc20Abi, functionName: "balanceOf", args: [owner] })
      .then((wei) => Number(formatUnits(wei, 18)))
      .catch(() => 0),
    client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    croPriceUsd(),
  ]);
  if (nativeRpc == null && nativeWallet == null) {
    throw new Error("Could not read the CRO balance from Cronos.");
  }
  const sol = mergeNativeBalance([nativeRpc, nativeWallet]);
  const wcro = Number.isFinite(wcroRaw) ? wcroRaw : 0;
  const usdc = Number(formatUnits(usdcRaw, 6));
  const solPriceUsd = price && price > 0 ? price : null;
  const equityUsd = usdc + (sol + wcro) * (solPriceUsd ?? 0);
  return { address, sol, wcro, usdc, solPriceUsd, equityUsd };
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

function selectedAddress(provider: EthereumProvider): string | null {
  const selected = (provider as { selectedAddress?: unknown }).selectedAddress;
  return typeof selected === "string" ? selected : null;
}

async function accountWithCro(provider: EthereumProvider, accounts: string[]): Promise<string> {
  if (accounts.length === 1) return accounts[0]!;
  const rows = await Promise.all(
    accounts.map(async (account) => ({ account, bal: await readCronosBalances(account, provider) })),
  );
  return preferFundedAccount(rows);
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
  if (!provider) throw new Error("No Cronos wallet found. Install the Crypto.com Onchain extension, then reload.");
  const accounts = orderCronosAccounts(
    await provider.request({ method: onlyIfTrusted ? "eth_accounts" : "eth_requestAccounts" }),
    selectedAddress(provider),
  );
  if (!accounts.length) throw new Error(onlyIfTrusted ? "Wallet is not connected." : "Wallet connected but did not return an account.");
  if (!onlyIfTrusted) await ensureCronos(provider);
  else {
    const current = await provider.request({ method: "eth_chainId" });
    if (!chainIsCronos(current)) throw new Error("Wallet is not on Cronos.");
  }
  const address = await accountWithCro(provider, accounts);
  const balances = await readCronosBalances(address, provider);
  return { ...balances, provider };
}

export async function refreshCronos(session: CronosSession): Promise<CronosSession> {
  const balances = await readCronosBalances(session.address, session.provider);
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
