import type { ChainId } from "@/lib/chain";
import { collectSignerSecrets } from "@/lib/keystore";
import { DESK_RUNNER_PORT, localRunnerOrigin, runnerBookUrl, runnerStatusUrl } from "@/lib/trading/runtime";
import type { AppState } from "@/lib/types";
import type { CronosSession } from "@/lib/cronos/wallet";
import type { WalletSession } from "@/lib/solana/wallet";

export interface DeskRunnerStatus {
  ok: true;
  runner: true;
  port?: number;
  armed?: Partial<Record<ChainId, boolean>>;
}

export interface DeskBookPayload {
  wallet: string;
  state: AppState;
  keys?: Record<string, string>;
}

let foundOrigin = "";

export function runnerOrigin(): string {
  return foundOrigin;
}

export function isDeskChain(value: string): value is ChainId {
  return value === "solana" || value === "cronos";
}

export function runnerProbeUrls(origin = typeof window !== "undefined" ? window.location.origin : ""): string[] {
  const urls = [runnerStatusUrl(origin)];
  if (typeof window !== "undefined" && window.location.protocol !== "https:") {
    const local = localRunnerOrigin(DESK_RUNNER_PORT);
    if (origin !== local) urls.push(runnerStatusUrl(local));
  }
  return urls;
}

export async function detectDeskRunner(): Promise<DeskRunnerStatus | null> {
  for (const url of runnerProbeUrls()) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const json = (await res.json()) as DeskRunnerStatus;
      if (json?.ok && json.runner) {
        const origin = new URL(url).origin;
        foundOrigin = typeof window !== "undefined" && origin === window.location.origin ? "" : origin;
        return json;
      }
    } catch {
      // The published HTTPS site cannot talk to a local HTTP runner.
    }
  }
  return null;
}

export async function pullDeskBook(chain: string, origin = foundOrigin): Promise<DeskBookPayload | null> {
  try {
    const res = await fetch(runnerBookUrl(chain, origin), { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as DeskBookPayload;
    if (!json?.wallet || !json.state?.config || !json.state.portfolio) return null;
    return { wallet: json.wallet, state: json.state };
  } catch {
    return null;
  }
}

export async function pushDeskBook(chain: string, payload: DeskBookPayload, origin = foundOrigin): Promise<boolean> {
  try {
    const res = await fetch(runnerBookUrl(chain, origin), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function publishDeskBook(chain: ChainId, wallet: string, state: AppState): Promise<boolean> {
  return pushDeskBook(chain, { wallet, state, keys: collectSignerSecrets(wallet) });
}

export function runnerWalletSession(address: string): WalletSession {
  return {
    address,
    sol: 0,
    usdc: 0,
    solPriceUsd: null,
    equityUsd: 0,
    provider: {
      connect: async () => ({ publicKey: { toBase58: () => address } }),
    },
  };
}

export function runnerCronosSession(address: string): CronosSession {
  return {
    address,
    sol: 0,
    wcro: 0,
    posCro: 0,
    usdc: 0,
    solPriceUsd: null,
    equityUsd: 0,
    provider: {
      request: async () => {
        throw new Error("The desk runner signs from the trading key, not the wallet.");
      },
    },
  };
}
