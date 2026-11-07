import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { agentPermissionMemo, permissionSignatureMatches } from "@/lib/trading/agentPermission";
import type { AgentSession } from "@/lib/types";
import {
  clearPendingAgentGrant,
  readPendingAgentGrant,
  rememberPendingAgentGrant,
  type PendingAgentGrant,
} from "./agentGrantStore";
import { broadcastTransaction, confirmSignature, solanaRpc, type WalletSession } from "./wallet";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export interface AgentSignOptions {
  /** Trading key that may send manual buys and sells until the window ends. */
  delegate: string;
  blockhash?: string;
  /** Funding transfers. The same signature covers these and the time window. */
  extraInstructions?: TransactionInstruction[];
  /** Tests check the signature locally and do not send. */
  broadcast?: boolean;
  /** Saved with the phone handoff so the window can finish after Phantom returns. */
  minutes?: number;
  live?: boolean;
}

export function buildAgentPermissionTransaction(input: {
  owner: PublicKey;
  delegate: string;
  expiresAt: string;
  blockhash: string;
  extraInstructions?: TransactionInstruction[];
}): Transaction {
  const tx = new Transaction();
  tx.feePayer = input.owner;
  tx.recentBlockhash = input.blockhash;
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }));
  tx.add(memoInstruction(input.owner, agentPermissionMemo(input.owner.toBase58(), input.delegate, input.expiresAt)));
  for (const instruction of input.extraInstructions ?? []) tx.add(instruction);
  return tx;
}

function memoInstruction(owner: PublicKey, text: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [{ pubkey: owner, isSigner: true, isWritable: false }],
    data: Buffer.from(text, "utf8"),
  });
}

function readSignedTransaction(signed: {
  serialize(options?: { requireAllSignatures?: boolean; verifySignatures?: boolean }): Uint8Array;
}): Transaction {
  return Transaction.from(signed.serialize({ requireAllSignatures: false, verifySignatures: false }));
}

/** Proof that the connected wallet signed this exact transaction. */
export function agentSessionFromTransaction(
  tx: Transaction,
  fields: { owner: string; delegate: string; expiresAt: string; minutes?: number },
): AgentSession {
  const owner = new PublicKey(fields.owner);
  const message = tx.serializeMessage();
  const signature = tx.signatures.find((row) => row.publicKey.equals(owner))?.signature;
  if (!signature) throw new Error("The wallet did not sign the agent transaction.");
  if (!nacl.sign.detached.verify(message, signature, owner.toBytes())) {
    throw new Error("That signature does not match this wallet.");
  }
  const grant: AgentSession = {
    owner: fields.owner,
    delegate: fields.delegate,
    signedAt: new Date().toISOString(),
    expiresAt: fields.expiresAt,
    minutes: fields.minutes ?? 0,
    signature: bs58.encode(signature),
    message: Buffer.from(message).toString("base64"),
  };
  if (!permissionSignatureMatches(grant)) throw new Error("That signature does not match this wallet.");
  return grant;
}

/** A phone approval comes back as raw transaction bytes. Null when they are not this window. */
export function agentGrantFromSignedBytes(bytes: Uint8Array, pending: PendingAgentGrant): AgentSession | null {
  try {
    const session = agentSessionFromTransaction(Transaction.from(bytes), pending);
    if (session.owner !== pending.owner || session.delegate !== pending.delegate || session.expiresAt !== pending.expiresAt) {
      return null;
    }
    return { ...session, minutes: pending.minutes };
  } catch {
    return null;
  }
}

/** Finish a window Phantom signed on the phone, then forget the handoff. */
export function takeReturnedAgentGrant(owner: string): { session: AgentSession; live: boolean } | null {
  const found = readPendingAgentGrant();
  if (!found || found.pending.owner !== owner) return null;
  const session = agentGrantFromSignedBytes(found.signed, found.pending);
  clearPendingAgentGrant();
  if (!session) return null;
  return { session, live: found.pending.live };
}

async function latestBlockhash(): Promise<string> {
  const hash = await solanaRpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
  if (!hash.value?.blockhash) throw new Error("Solana did not return a blockhash.");
  return hash.value.blockhash;
}

/**
 * One wallet prompt. The signed transaction allows every manual buy and sell until `expiresAt`.
 * It is not a seed and not the trading key.
 */
export async function signAgentPermission(
  session: WalletSession,
  expiresAt: string,
  options: AgentSignOptions,
): Promise<AgentSession> {
  const provider = session.provider;
  if (!provider.signTransaction) {
    throw new Error("This wallet cannot sign the agent transaction. Connect Phantom or Solflare.");
  }
  let owner: PublicKey;
  let delegate: PublicKey;
  try {
    owner = new PublicKey(session.address);
    delegate = new PublicKey(options.delegate);
  } catch {
    throw new Error("The agent transaction needs the connected wallet and a trading key.");
  }
  if (delegate.equals(owner)) throw new Error("The trading key has to be separate from the connected wallet.");
  rememberPendingAgentGrant({
    owner: owner.toBase58(),
    delegate: delegate.toBase58(),
    expiresAt,
    minutes: options.minutes ?? 0,
    live: Boolean(options.live),
  });
  const tx = buildAgentPermissionTransaction({
    owner,
    delegate: delegate.toBase58(),
    expiresAt,
    blockhash: options.blockhash ?? (await latestBlockhash()),
    extraInstructions: options.extraInstructions,
  });
  let signedTx: Transaction;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const signed = await Promise.race([
      provider.signTransaction(tx),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("The wallet did not open a signature. Enable the agent again and approve the transaction.")),
          45_000,
        );
      }),
    ]);
    signedTx = readSignedTransaction(signed);
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    if (/reject|denied|cancel|closed|declin/i.test(text)) {
      clearPendingAgentGrant();
      throw new Error("The wallet declined the agent transaction.");
    }
    throw new Error(text || "The wallet did not sign the agent transaction.");
  } finally {
    if (timer) clearTimeout(timer);
  }
  let grant: AgentSession;
  try {
    grant = agentSessionFromTransaction(signedTx, {
      owner: owner.toBase58(),
      delegate: delegate.toBase58(),
      expiresAt,
    });
  } catch (error) {
    clearPendingAgentGrant();
    throw error;
  }
  const funded = (options.extraInstructions?.length ?? 0) > 0;
  if (options.broadcast !== false) {
    try {
      const sent = await broadcastTransaction(signedTx.serialize());
      if (!sent) throw new Error("The wallet signed, but Solana did not accept the agent transaction.");
      await confirmSignature(sent);
    } catch (error) {
      if (funded) {
        clearPendingAgentGrant();
        const text = error instanceof Error ? error.message : "";
        throw new Error(text || "The wallet signed, but Solana did not accept the agent transaction.");
      }
      // A practice window is the signature. Browser fills still run if the memo does not land.
    }
  }
  clearPendingAgentGrant();
  return grant;
}
