import { fetchJson, nullableNum } from "@/lib/utils";
import { encodeFunctionData, formatUnits } from "viem";
import { createPublicClient, erc20Abi, fallback, http } from "viem";
import { cronos } from "viem/chains";
import {
  chainIsCronos,
  collectPosAccounts,
  croPosToEvm,
  evmToCroPos,
  mergeNativeBalance,
  orderCronosAccounts,
  parseRpcQuantity,
  preferFundedAccount,
} from "./balance";
import { CRONOS_CHAIN_ID, CRONOS_POS_LCDS, CRONOS_RPCS, USDC, WCRO } from "./constants";
import { labelCronosProvider, pickCronosProvider, type CronosInjected, type CronosInjectedWindow } from "./provider";

export interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

export interface CronosSession {
  address: string;
  /** Native CRO. Gas is paid from this, not from wrapped CRO. */
  sol: number;
  /** Wrapped CRO. The wallet balance is native plus this. */
  wcro: number;
  /** Cronos POS CRO. WolfSwap cannot spend this until it is sent to Cronos EVM. */
  posCro: number;
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

async function walletRpc(provider: EthereumProvider, method: string, params: unknown[]): Promise<unknown> {
  try {
    return await provider.request({ method, params });
  } catch {
    // Onchain allows eth_getBalance only through the proxy.
  }
  const bodies = [
    { method: "eth_proxyJsonRpcRequest", params: [{ method, params }] },
    { method: "eth_proxyJsonRpcRequest", params: { method, params } },
  ];
  for (const body of bodies) {
    try {
      const raw = await provider.request(body);
      if (raw && typeof raw === "object" && "result" in raw) return (raw as { result: unknown }).result;
      return raw;
    } catch {
      // Try the next parameter shape.
    }
  }
  return null;
}

async function rpcNative(owner: `0x${string}`): Promise<number | null> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [owner, "latest"] });
  for (const url of CRONOS_RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) continue;
      const wei = parseRpcQuantity(await res.json());
      if (wei != null) return Number(formatUnits(wei, 18));
    } catch {
      // The next node is the backup.
    }
  }
  return null;
}

async function providerNative(provider: EthereumProvider, owner: `0x${string}`): Promise<number | null> {
  const hex = await walletRpc(provider, "eth_getBalance", [owner, "latest"]);
  const wei = parseRpcQuantity(hex);
  if (wei == null) return null;
  return Number(formatUnits(wei, 18));
}

async function tokenUnits(
  token: `0x${string}`,
  owner: `0x${string}`,
  decimals: number,
  provider?: EthereumProvider | null,
): Promise<number> {
  const fromNode = await client
    .readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] })
    .then((wei) => Number(formatUnits(wei, decimals)))
    .catch(() => null);
  if (fromNode && fromNode > 0) return fromNode;
  if (!provider) return fromNode ?? 0;
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [owner] });
  const hex = await walletRpc(provider, "eth_call", [{ to: token, data }, "latest"]);
  const wei = parseRpcQuantity(hex);
  if (wei == null) return fromNode ?? 0;
  return Number(formatUnits(wei, decimals));
}

export async function readPosCro(accounts: string[]): Promise<number> {
  if (!accounts.length) return 0;
  for (const base of CRONOS_POS_LCDS) {
    const totals = await Promise.all(
      accounts.map(async (account) => {
        try {
          const json = await fetchJson<{ balances?: Array<{ denom?: string; amount?: string }> }>(
            `${base}/cosmos/bank/v1beta1/balances/${account}`,
            { timeoutMs: 4_000, retries: 1 },
          );
          const raw = json.balances?.find((row) => row.denom === "basecro")?.amount;
          if (!raw) return 0;
          return Number(formatUnits(BigInt(raw), 8));
        } catch {
          return 0;
        }
      }),
    );
    const sum = totals.reduce((a, b) => a + b, 0);
    if (sum > 0) return sum;
  }
  return 0;
}

export async function readCronosBalances(
  address: string,
  provider?: EthereumProvider | null,
  posAccounts: string[] = [],
): Promise<Omit<CronosSession, "provider">> {
  const owner = address as `0x${string}`;
  const derivedPos = evmToCroPos(address);
  const pos = derivedPos && !posAccounts.includes(derivedPos) ? [...posAccounts, derivedPos] : posAccounts;
  const [nativeRpc, nativeWallet, nativeViem, wcro, usdc, posCro, price] = await Promise.all([
    rpcNative(owner),
    provider ? providerNative(provider, owner) : Promise.resolve(null),
    client.getBalance({ address: owner }).then(
      (wei) => Number(formatUnits(wei, 18)),
      () => null,
    ),
    tokenUnits(WCRO, owner, 18, provider),
    tokenUnits(USDC, owner, 6, provider),
    readPosCro(pos),
    croPriceUsd(),
  ]);
  const sol = mergeNativeBalance([nativeRpc, nativeWallet, nativeViem]);
  if (nativeRpc == null && nativeWallet == null && nativeViem == null && !(wcro > 0) && !(posCro > 0)) {
    throw new Error("Could not read the CRO balance from Cronos.");
  }
  const solPriceUsd = price && price > 0 ? price : null;
  const equityUsd = usdc + (sol + wcro) * (solPriceUsd ?? 0);
  return { address, sol, wcro, posCro, usdc, solPriceUsd, equityUsd };
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

async function listPosAccounts(provider: EthereumProvider): Promise<string[]> {
  const found: string[] = [];
  for (const method of ["cosmos_getAccounts", "wallet_getAllAccounts"] as const) {
    try {
      collectPosAccounts(await provider.request({ method }), found);
    } catch {
      // The wallet may not expose this method.
    }
  }
  return found;
}

async function listCronosAccounts(provider: EthereumProvider, requested: unknown): Promise<{ evm: string[]; pos: string[] }> {
  const extra: unknown[] = [requested, selectedAddress(provider)];
  for (const method of ["eth_accounts", "wallet_getAllAccounts"] as const) {
    try {
      extra.push(await provider.request({ method }));
    } catch {
      // Keep the accounts we already have.
    }
  }
  const pos = await listPosAccounts(provider);
  const evm = orderCronosAccounts(extra);
  for (const account of pos) {
    const converted = croPosToEvm(account);
    if (converted && !evm.includes(converted)) evm.push(converted);
  }
  return { evm, pos };
}

async function accountWithCro(
  provider: EthereumProvider,
  accounts: string[],
  posAccounts: string[],
): Promise<string> {
  if (!accounts.length) throw new Error("Wallet connected but did not return an account.");
  if (accounts.length === 1) return accounts[0]!;
  const rows = await Promise.all(
    accounts.map(async (account) => ({ account, bal: await readCronosBalances(account, provider, posAccounts) })),
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
  const requested = await provider.request({
    method: onlyIfTrusted ? "eth_accounts" : "eth_requestAccounts",
  });
  if (!onlyIfTrusted) await ensureCronos(provider);
  else {
    const current = await provider.request({ method: "eth_chainId" });
    if (!chainIsCronos(current)) await ensureCronos(provider);
  }
  const { evm, pos } = await listCronosAccounts(provider, requested);
  if (!evm.length) throw new Error(onlyIfTrusted ? "Wallet is not connected." : "Wallet connected but did not return an account.");
  const address = await accountWithCro(provider, evm, pos);
  const balances = await readCronosBalances(address, provider, pos);
  return { ...balances, provider };
}

function keepSessionHoldings(
  previous: CronosSession,
  next: Omit<CronosSession, "provider">,
): Omit<CronosSession, "provider"> {
  const same = previous.address.toLowerCase() === next.address.toLowerCase();
  if (!same) return next;
  const nextEvm = next.sol + next.wcro;
  return {
    ...next,
    sol: nextEvm > 0 ? next.sol : previous.sol,
    wcro: nextEvm > 0 ? next.wcro : previous.wcro,
    usdc: Math.max(next.usdc, previous.usdc),
    posCro: Math.max(next.posCro, previous.posCro),
    solPriceUsd: next.solPriceUsd ?? previous.solPriceUsd,
    equityUsd:
      Math.max(next.usdc, previous.usdc) +
      (nextEvm > 0 ? nextEvm : previous.sol + previous.wcro) * (next.solPriceUsd ?? previous.solPriceUsd ?? 0),
  };
}

export async function refreshCronos(session: CronosSession): Promise<CronosSession> {
  const { evm, pos } = await listCronosAccounts(session.provider, session.address).catch(() => ({
    evm: [session.address],
    pos: [] as string[],
  }));
  const candidates = evm.length ? evm : [session.address];
  const address = await accountWithCro(session.provider, candidates, pos);
  const balances = await readCronosBalances(address, session.provider, pos);
  return { ...session, ...keepSessionHoldings(session, balances) };
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
