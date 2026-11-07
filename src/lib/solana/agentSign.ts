import bs58 from "bs58";
import type { WalletSession } from "./wallet";
import { agentPermissionMessage, permissionSignatureMatches } from "@/lib/trading/agentPermission";
import type { AgentSession } from "@/lib/types";

type SignedMessage = { signature: Uint8Array } | Uint8Array;

function signatureBytes(signed: SignedMessage): Uint8Array | null {
  const bytes = signed instanceof Uint8Array ? signed : signed?.signature;
  if (!(bytes instanceof Uint8Array) || bytes.length !== 64) return null;
  return bytes;
}

/** One wallet prompt. The signature is stored as proof of the time window. It is not a trading key. */
export async function signAgentPermission(session: WalletSession, expiresAt: string): Promise<AgentSession> {
  const provider = session.provider as WalletSession["provider"] & {
    signMessage?: (message: Uint8Array, display?: "utf8" | "hex") => Promise<SignedMessage>;
  };
  if (!provider.signMessage) {
    throw new Error("This wallet cannot sign the agent permission. Connect Phantom or Solflare.");
  }
  const message = agentPermissionMessage(session.address, expiresAt);
  let signed: SignedMessage;
  try {
    signed = await provider.signMessage(new TextEncoder().encode(message), "utf8");
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    if (/reject|denied|cancel|closed|declin/i.test(text)) {
      throw new Error("The wallet declined the agent permission.");
    }
    throw new Error(text || "The wallet did not sign the agent permission.");
  }
  const bytes = signatureBytes(signed);
  if (!bytes) throw new Error("The wallet did not return a signature.");
  const grant: AgentSession = {
    owner: session.address,
    signedAt: new Date().toISOString(),
    expiresAt,
    minutes: 0,
    signature: bs58.encode(bytes),
  };
  if (!permissionSignatureMatches(grant)) throw new Error("That signature does not match this wallet.");
  return grant;
}
