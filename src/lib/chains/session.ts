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
  detectedCronosWallet,
  disconnectCronos,
  listenCronos,
  refreshCronos,
  type CronosSession,
  type EthereumProvider,
} from "@/lib/cronos/wallet";
import { connectDash, disconnectDash, refreshDash, type DashSession } from "@/lib/dash/trade";
import { dashPayInstalled } from "@/lib/dash/wallet";

export type DeskSession = WalletSession | CronosSession | DashSession;

export async function connectDesk(
  chain: ChainId,
  trusted = false,
  side?: "dashpay" | "near",
): Promise<DeskSession> {
  if (chain === "cronos") return connectCronos(trusted);
  if (chain === "dash") return connectDash(trusted, side);
  return connectWallet(trusted);
}

export async function refreshDesk(chain: ChainId, session: DeskSession): Promise<DeskSession> {
  if (chain === "cronos") return refreshCronos(session as CronosSession);
  if (chain === "dash") return refreshDash(session as DashSession);
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
  if (chain === "dash") return () => undefined;
  if (chain === "cronos") return listenCronos((session as CronosSession).provider, handlers);
  return listenWallet((session as WalletSession).provider, handlers);
}

export async function disconnectDesk(chain: ChainId, session?: DeskSession | null): Promise<void> {
  if (chain === "dash") {
    disconnectDash();
    return;
  }
  if (chain === "cronos") {
    await disconnectCronos((session as CronosSession | null | undefined)?.provider);
    return;
  }
  await disconnectWallet((session as WalletSession | null | undefined)?.provider);
}

export function detectedDeskWallet(chain: ChainId): string | null {
  if (chain === "cronos") return detectedCronosWallet();
  if (chain === "dash") return dashPayInstalled() ? "DashPay" : null;
  return detectedWalletName();
}

export function isEthereumProvider(value: unknown): value is EthereumProvider {
  return Boolean(value && typeof value === "object" && "request" in value);
}
