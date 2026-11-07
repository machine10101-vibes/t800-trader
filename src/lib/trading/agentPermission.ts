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

/**
 * Memo inside the wallet transaction.
 * Changing the expiry or the trading key changes the transaction, so an edited clock fails the check.
 */
export function agentPermissionMemo(owner: string, delegate: string, expiresAt: string): string {
  return [
    "T-800 Trader",
    "Allow all manual trades from the AI agent until the time below.",
    `Wallet: ${owner}`,
    `Trader: ${delegate}`,
    `Until: ${expiresAt}`,
    "This transaction lets that trader send every manual buy and sell in the window.",
  ].join("\n");
}

export function permissionSignatureMatches(session: AgentSession): boolean {
  try {
    if (!session.message || !session.delegate || !session.signature || !session.owner || !session.expiresAt) return false;
    const message = Buffer.from(session.message, "base64");
    const memo = Buffer.from(agentPermissionMemo(session.owner, session.delegate, session.expiresAt), "utf8");
    if (message.indexOf(memo) < 0) return false;
    const signature = bs58.decode(session.signature);
    const owner = new PublicKey(session.owner).toBytes();
    if (signature.length !== 64 || owner.length !== 32 || message.length < 64) return false;
    return nacl.sign.detached.verify(message, signature, owner);
  } catch {
    return false;
  }
}

/**
 * Why an agent trade must wait. Null means this window may trade without another wallet prompt.
 * `wallet` is the connected address. A window signed by a different wallet does not apply.
 */
export function agentPermissionBlock(state: AppState, now = Date.now(), wallet?: string | null): string | null {
  const session = state.bot.agentSession;
  if (!session?.signature || !session.expiresAt || !session.message) {
    return "Enable the AI agent and approve the wallet transaction. Manual trades stay off until then.";
  }
  const expires = Date.parse(session.expiresAt);
  if (!Number.isFinite(expires) || expires <= now) {
    return "That trading window ended. Enable the agent again and approve a new transaction.";
  }
  if (wallet && session.owner !== wallet) {
    return "That trading window was signed by a different wallet.";
  }
  if (state.config.walletSwaps && state.bot.swapBot && session.delegate !== state.bot.swapBot) {
    return "That trading window does not match the trading key.";
  }
  if (!permissionSignatureMatches(session)) {
    return "That trading window does not match the wallet transaction.";
  }
  return null;
}
