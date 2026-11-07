import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import type { AgentSession, AppState } from "@/lib/types";

/** Shortest permission the desk will sign. */
export const AGENT_PERMISSION_MIN = 5;
/** Longest permission the desk will sign, in minutes. */
export const AGENT_PERMISSION_MAX = 72 * 60;

export const AGENT_PERMISSION_PRESETS = [
  { minutes: 15, label: "15 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
  { minutes: 720, label: "12 hours" },
  { minutes: 1440, label: "24 hours" },
] as const;

export function clampAgentMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return 60;
  return Math.min(AGENT_PERMISSION_MAX, Math.max(AGENT_PERMISSION_MIN, Math.round(minutes)));
}

/** The exact text the wallet signs. Changing the expiry changes the message, so an edited clock fails the check. */
export function agentPermissionMessage(owner: string, expiresAt: string): string {
  return [
    "T-800 Trader",
    "Allow AI agent trades on this Solana book until the time below.",
    `Wallet: ${owner}`,
    `Until: ${expiresAt}`,
    "This signature does not move funds and does not reveal a key.",
  ].join("\n");
}

export function permissionSignatureMatches(session: AgentSession): boolean {
  try {
    const message = new TextEncoder().encode(agentPermissionMessage(session.owner, session.expiresAt));
    const signature = bs58.decode(session.signature);
    const owner = new PublicKey(session.owner).toBytes();
    if (signature.length !== 64 || owner.length !== 32) return false;
    return nacl.sign.detached.verify(message, signature, owner);
  } catch {
    return false;
  }
}

/** Why an agent trade must wait. Null means this session may trade without another wallet prompt. */
export function agentPermissionBlock(state: AppState, now = Date.now()): string | null {
  const session = state.bot.agentSession;
  if (!session?.signature || !session.expiresAt) {
    return "Enable the AI agent on the Sol desk and sign once. Agent trades stay off until then.";
  }
  const expires = Date.parse(session.expiresAt);
  if (!Number.isFinite(expires) || expires <= now) {
    return "That agent permission ended. Enable it again and sign once.";
  }
  if (!permissionSignatureMatches(session)) {
    return "That agent permission does not match the wallet signature.";
  }
  return null;
}
