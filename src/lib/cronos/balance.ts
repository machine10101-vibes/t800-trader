import { getAddress } from "viem";

/** Native reads from a public node and from the wallet. The larger one is the balance. */
export function mergeNativeBalance(reads: Array<number | null | undefined>): number {
  let best = 0;
  for (const read of reads) {
    if (read == null || !Number.isFinite(read) || read <= best) continue;
    best = read;
  }
  return best;
}

export function croHoldings(
  session: { sol: number; usdc?: number; wcro?: number; solPriceUsd?: number | null },
  chartPrice = 0,
): { cro: number; usd: number } {
  const cro = Math.max(0, session.sol) + Math.max(0, session.wcro ?? 0);
  const quoted = session.solPriceUsd && session.solPriceUsd > 0 ? session.solPriceUsd : chartPrice;
  const price = quoted > 0 ? quoted : 0;
  return { cro, usd: Math.max(0, session.usdc ?? 0) + cro * price };
}

export function chainIsCronos(chainId: unknown): boolean {
  if (typeof chainId === "number") return chainId === 25;
  if (typeof chainId === "bigint") return chainId === 25n;
  if (typeof chainId !== "string") return false;
  const trimmed = chainId.trim().toLowerCase();
  if (trimmed === "25" || trimmed === "0x19") return true;
  if (!/^0x[0-9a-f]+$/.test(trimmed)) return false;
  try {
    return BigInt(trimmed) === 25n;
  } catch {
    return false;
  }
}

function asAddress(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null;
    return getAddress(trimmed);
  }
  if (!value || typeof value !== "object") return null;
  const record = value as { address?: unknown; account?: unknown };
  return asAddress(record.address ?? record.account);
}

/** The Onchain wallet may return one address string, a list, or the selected account beside an empty one. */
export function orderCronosAccounts(result: unknown, selected?: string | null): string[] {
  const found: string[] = [];
  const push = (value: unknown) => {
    const address = asAddress(value);
    if (!address || found.includes(address)) return;
    found.push(address);
  };
  push(selected);
  if (Array.isArray(result)) {
    for (const item of result) push(item);
  } else {
    push(result);
  }
  return found;
}

export function preferFundedAccount<T extends { sol: number; wcro?: number; usdc: number }>(
  rows: Array<{ account: string; bal: T }>,
): string {
  if (!rows.length) throw new Error("Wallet connected but did not return an account.");
  const score = (bal: T) => bal.sol + (bal.wcro ?? 0) + bal.usdc;
  const selected = rows[0]!;
  if (score(selected.bal) > 0 || rows.length === 1) return selected.account;
  return rows.reduce((best, row) => (score(row.bal) > score(best.bal) ? row : best)).account;
}
