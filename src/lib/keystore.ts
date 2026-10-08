/** Secrets for the trading keys. The browser uses localStorage. The desk runner uses a file map. */

export type KeyBackend = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove?(key: string): void;
  keys?(): string[];
};

let backend: KeyBackend | null = null;

export function useDeskKeys(next: KeyBackend | null): void {
  backend = next;
}

export function deskKeysReady(): boolean {
  return backend != null;
}

export function readSecret(key: string): string | null {
  if (typeof window !== "undefined") {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return backend?.get(key) ?? null;
}

export function writeSecret(key: string, value: string): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Private mode still lets this page sign from memory this session.
    }
    return;
  }
  backend?.set(key, value);
}

export function solanaSignerKey(owner: string): string {
  return `t800-trader-signer:${owner}`;
}

export function cronosSignerKey(owner: string): string {
  return `t800-trader-signer:cronos:${owner.toLowerCase()}`;
}

export function collectSignerSecrets(owner: string): Record<string, string> {
  const out: Record<string, string> = {};
  const sol = readSecret(solanaSignerKey(owner));
  if (sol) out[solanaSignerKey(owner)] = sol;
  const cro = readSecret(cronosSignerKey(owner));
  if (cro) out[cronosSignerKey(owner)] = cro;
  return out;
}
