import bs58 from "bs58";

const PENDING = "t800-agent-grant";
const SIGNED = "t800-phantom-signed-tx";

export interface PendingAgentGrant {
  owner: string;
  delegate: string;
  expiresAt: string;
  minutes: number;
  live: boolean;
}

function readStored(key: string): string | null {
  try {
    const local = localStorage.getItem(key);
    if (local) return local;
  } catch {
    // A phone return can land in a tab that only has the other store.
  }
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The session copy covers this tab if the phone keeps it alive.
  }
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // One of the two stores is enough.
  }
}

function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // The session copy is removed below.
  }
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Nothing left to finish on the next page load.
  }
}

export function rememberPendingAgentGrant(grant: PendingAgentGrant): void {
  writeStored(PENDING, JSON.stringify(grant));
}

export function clearPendingAgentGrant(): void {
  removeStored(PENDING);
  removeStored(SIGNED);
}

/** Phantom on a phone returns the signed bytes on the next page load. */
export function holdPhantomSignedTransaction(bytes: Uint8Array): void {
  writeStored(SIGNED, bs58.encode(bytes));
}

export function readPendingAgentGrant(): { pending: PendingAgentGrant; signed: Uint8Array } | null {
  try {
    const raw = readStored(PENDING);
    const encoded = readStored(SIGNED);
    if (!raw || !encoded) return null;
    const pending = JSON.parse(raw) as Partial<PendingAgentGrant>;
    if (!pending.owner || !pending.delegate || !pending.expiresAt) return null;
    return {
      pending: {
        owner: pending.owner,
        delegate: pending.delegate,
        expiresAt: pending.expiresAt,
        minutes: Number.isFinite(pending.minutes) ? Number(pending.minutes) : 0,
        live: Boolean(pending.live),
      },
      signed: bs58.decode(encoded),
    };
  } catch {
    return null;
  }
}
