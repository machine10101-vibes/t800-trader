import { DASH_TOKEN, NEAR_RPC, NEAR_USDT, tokenDecimals } from "./constants";
import { unitsToAmount } from "./quote";

export interface DashSession {
  address: string;
  nearAccountId: string | null;
  dashAccount: string | null;
  /** DASH held on the NEAR account. */
  sol: number;
  /** USDT held on the NEAR account. */
  usdc: number;
  /** Spare NEAR for the network fee. */
  near: number;
  solPriceUsd: number | null;
  equityUsd: number;
  provider: { kind: "dash" };
}

interface DashSigner {
  connect: () => Promise<unknown>;
  currentIdentity?: string;
  identities?: unknown;
}

interface DashWindow {
  dashPlatformExtension?: { signer?: DashSigner };
}

function dashWindow(): DashWindow | null {
  if (typeof window === "undefined") return null;
  return window as DashWindow;
}

export function dashPayInstalled(): boolean {
  return typeof dashWindow()?.dashPlatformExtension?.signer?.connect === "function";
}

/** A named `.near` account or a 64-character implicit account. */
export function parseNearAccount(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (/^[a-z0-9_-]{2,64}\.near$/.test(value)) return value;
  if (/^[a-f0-9]{64}$/.test(value)) return value;
  return null;
}

export function dashAccountFrom(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = dashAccountFrom(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  for (const key of ["currentIdentity", "identity", "address", "accountId", "account", "id"]) {
    const found = dashAccountFrom(row[key]);
    if (found) return found;
  }
  return dashAccountFrom(row.identities);
}

export async function connectDashPay(): Promise<string> {
  const signer = dashWindow()?.dashPlatformExtension?.signer;
  if (!signer?.connect) throw new Error("No DashPay wallet found. Install the Dash Platform extension, then reload.");
  const result = await signer.connect();
  const account = dashAccountFrom(result) || dashAccountFrom(signer.currentIdentity) || dashAccountFrom(signer.identities);
  if (!account) throw new Error("DashPay connected but did not return an account.");
  return account;
}

async function nearView(account: string, method: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: account,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const json = (await res.json()) as { result?: { result?: number[] } };
  const bytes = json.result?.result;
  if (!bytes?.length) return null;
  const text = new TextDecoder().decode(new Uint8Array(bytes));
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function ftBalance(token: string, owner: string): Promise<number> {
  const raw = await nearView(token, "ft_balance_of", { account_id: owner });
  const digits = typeof raw === "string" ? raw : "";
  return unitsToAmount(digits, tokenDecimals(token));
}

async function nativeNear(account: string): Promise<number> {
  const res = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: { request_type: "view_account", finality: "final", account_id: account },
    }),
  });
  const json = (await res.json()) as { result?: { amount?: string } };
  return unitsToAmount(json.result?.amount ?? "0", 24);
}

export async function dashPriceUsd(): Promise<number | null> {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=dash&vs_currencies=usd");
    const json = (await res.json()) as { dash?: { usd?: number } };
    const price = json.dash?.usd;
    return typeof price === "number" && price > 0 ? price : null;
  } catch {
    return null;
  }
}

export async function readDashBalances(nearAccountId: string | null, priceHint?: number | null): Promise<{
  sol: number;
  usdc: number;
  near: number;
  solPriceUsd: number | null;
  equityUsd: number;
}> {
  const price = priceHint && priceHint > 0 ? priceHint : await dashPriceUsd();
  if (!nearAccountId) return { sol: 0, usdc: 0, near: 0, solPriceUsd: price, equityUsd: 0 };
  const [dash, usdt, near] = await Promise.all([
    ftBalance(DASH_TOKEN, nearAccountId).catch(() => 0),
    ftBalance(NEAR_USDT, nearAccountId).catch(() => 0),
    nativeNear(nearAccountId).catch(() => 0),
  ]);
  const px = price ?? 0;
  return {
    sol: dash,
    usdc: usdt,
    near,
    solPriceUsd: price,
    equityUsd: usdt + dash * px,
  };
}

export function dashSession(input: {
  nearAccountId: string | null;
  dashAccount: string | null;
  sol: number;
  usdc: number;
  near: number;
  solPriceUsd: number | null;
  equityUsd: number;
}): DashSession {
  const address = input.nearAccountId || input.dashAccount || "";
  return { ...input, address, provider: { kind: "dash" } };
}
