import { getAddress, stringToHex } from "viem";
import { CRONOS_CHAIN_ID } from "./constants";

/** Crypto.com Onchain injects these. MetaMask often owns `window.ethereum` beside them. */
export interface CronosInjected {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  isDeficonnectProvider?: boolean;
  isDefiWallet?: boolean;
  isCryptoCom?: boolean;
  isMetaMask?: boolean;
  providers?: CronosInjected[];
}

export interface CronosInjectedWindow {
  ethereum?: CronosInjected;
  deficonnectProvider?: CronosInjected;
  deficonnect?: { ethereum?: CronosInjected };
}

export const ARM_ALREADY_FUNDED =
  "Arm T-800. The trading key already holds the balance, so no more CRO is moved.";

export const DISARM_RETURN = "Disarm T-800 and send the trading balance back to this wallet.";

export function isOnchainProvider(provider: object | null | undefined): boolean {
  if (!provider) return false;
  const flags = provider as CronosInjected;
  return Boolean(flags.isDeficonnectProvider || flags.isDefiWallet || flags.isCryptoCom);
}

export function labelCronosProvider(provider: CronosInjected | null | undefined): string | null {
  if (!provider?.request) return null;
  if (isOnchainProvider(provider)) return "Crypto.com Onchain";
  if (provider.isMetaMask) return "MetaMask";
  return "Ethereum wallet";
}

function canRequest(provider: CronosInjected | null | undefined): provider is CronosInjected {
  return typeof provider?.request === "function";
}

/**
 * Prefer the Onchain extension when several wallets are injected.
 * `window.ethereum` is the last resort, because MetaMask replaces it.
 */
export function pickCronosProvider(source: CronosInjectedWindow | null | undefined): CronosInjected | null {
  if (!source) return null;
  if (canRequest(source.deficonnectProvider)) return source.deficonnectProvider;
  if (canRequest(source.deficonnect?.ethereum)) return source.deficonnect.ethereum;
  const nested = source.ethereum?.providers?.find((item) => canRequest(item) && isOnchainProvider(item));
  if (nested) return nested;
  if (canRequest(source.ethereum) && isOnchainProvider(source.ethereum)) return source.ethereum;
  if (canRequest(source.ethereum)) return source.ethereum;
  return null;
}

/** At sign time, a captured MetaMask session must not hide the Onchain extension. */
export function chooseSignProvider<T extends { request: CronosInjected["request"] }>(
  picked: T | null | undefined,
  fallback?: T | null,
): T | null {
  if (picked && isOnchainProvider(picked)) return picked;
  if (fallback) return fallback;
  return picked ?? null;
}

export function rejectedByWallet(error: unknown): boolean {
  const code = typeof error === "object" && error && "code" in error ? Number((error as { code?: number }).code) : 0;
  if (code === 4001) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /reject|denied|cancel|closed|declin/i.test(message);
}

export function assertConnectedAccount(accounts: unknown, expected: string): string {
  const first = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : "";
  if (!first) throw new Error("Wallet connected but did not return an account.");
  if (getAddress(first) !== getAddress(expected)) {
    throw new Error("Switch the Onchain wallet to the connected account, then arm again.");
  }
  return getAddress(first);
}

export function cronosSendTx(input: { from: string; to: string; value?: bigint; data?: string }): Record<string, string> {
  const tx: Record<string, string> = {
    from: getAddress(input.from),
    to: getAddress(input.to),
    chainId: CRONOS_CHAIN_ID,
  };
  if (input.value && input.value > 0n) tx.value = `0x${input.value.toString(16)}`;
  if (input.data) tx.data = input.data;
  return tx;
}

function readSignature(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("0x")) throw new Error("Wallet did not return a signature");
  return value;
}

/** EIP-1474 hex message first. Some wallets want the plain string second, with the address first. */
export async function requestPersonalSign(
  provider: CronosInjected,
  from: string,
  message: string,
): Promise<string> {
  const checksum = getAddress(from);
  try {
    return readSignature(
      await provider.request({ method: "personal_sign", params: [stringToHex(message), checksum] }),
    );
  } catch (error) {
    if (rejectedByWallet(error)) throw error;
    return readSignature(await provider.request({ method: "personal_sign", params: [checksum, message] }));
  }
}
