import type { ChainId } from "@/lib/chain";
import {
  connectWallet,
  detectedWalletName,
  disconnectWallet,
  listenWallet,
  refreshWallet,
  type WalletSession,
} from "@/lib/solana/wallet";
import {
  connectCronos,
  disconnectCronos,
  listenCronos,
  refreshCronos,
  type CronosSession,
  type EthereumProvider,
} from "@/lib/cronos/wallet";

export type DeskSession = WalletSession | CronosSession;

export async function connectDesk(chain: ChainId, trusted = false): Promise<DeskSession> {
  if (chain === "cronos") return connectCronos(trusted);
  return connectWallet(trusted);
}

export async function refreshDesk(chain: ChainId, session: DeskSession): Promise<DeskSession> {
  if (chain === "cronos") return refreshCronos(session as CronosSession);
  return refreshWallet(session as WalletSession);
}

export function listenDesk(
  chain: ChainId,
  session: DeskSession,
  handlers: {
    onDisconnect?: () => void;
    onAccountChanged?: (address: string | null) => void;
  },
): () => void {
  if (chain === "cronos") return listenCronos((session as CronosSession).provider, handlers);
  return listenWallet((session as WalletSession).provider, handlers);
}

export async function disconnectDesk(chain: ChainId, session?: DeskSession | null): Promise<void> {
  if (chain === "cronos") {
    await disconnectCronos((session as CronosSession | null | undefined)?.provider);
    return;
  }
  await disconnectWallet((session as WalletSession | null | undefined)?.provider);
}

export function detectedDeskWallet(chain: ChainId): string | null {
  if (chain === "cronos") {
    if (typeof window === "undefined") return null;
    const eth = (window as Window & { ethereum?: { isMetaMask?: boolean; isDefiWallet?: boolean; isCryptoCom?: boolean } }).ethereum;
    if (!eth) return null;
    if (eth.isDefiWallet || eth.isCryptoCom) return "Crypto.com";
    if (eth.isMetaMask) return "MetaMask";
    return "Ethereum wallet";
  }
  return detectedWalletName();
}

export function isEthereumProvider(value: unknown): value is EthereumProvider {
  return Boolean(value && typeof value === "object" && "request" in value);
}
