import { getAddress } from "viem";

const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

/** Native reads from a public node and from the wallet. The larger one is the balance. */
export function formatCro(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 CRO";
  if (n >= 1000) return `${n.toFixed(1)} CRO`;
  if (n >= 0.001) return `${n.toFixed(3)} CRO`;
  return `${n.toFixed(6)} CRO`;
}

export function mergeNativeBalance(reads: Array<number | null | undefined>): number {
  let best = 0;
  for (const read of reads) {
    if (read == null || !Number.isFinite(read) || read <= best) continue;
    best = read;
  }
  return best;
}

export function croHoldings(
  session: { sol: number; usdc?: number; wcro?: number; posCro?: number; solPriceUsd?: number | null },
  chartPrice = 0,
): { cro: number; usd: number; evm: number; pos: number; onPos: boolean } {
  const evm = Math.max(0, session.sol) + Math.max(0, session.wcro ?? 0);
  const pos = Math.max(0, session.posCro ?? 0);
  const quoted = session.solPriceUsd && session.solPriceUsd > 0 ? session.solPriceUsd : chartPrice;
  const price = quoted > 0 ? quoted : 0;
  return {
    cro: evm,
    usd: Math.max(0, session.usdc ?? 0) + evm * price,
    evm,
    pos,
    onPos: evm === 0 && pos > 0,
  };
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

function asEvmAddress(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null;
    return getAddress(trimmed);
  }
  if (!value || typeof value !== "object") return null;
  const record = value as { address?: unknown; account?: unknown; evmAddress?: unknown };
  return asEvmAddress(record.address ?? record.account ?? record.evmAddress);
}

function asPosAddress(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^(cro|tcro)1[0-9a-z]{20,}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as { address?: unknown; account?: unknown; bech32Address?: unknown };
  return asPosAddress(record.address ?? record.account ?? record.bech32Address);
}

export function collectEvmAccounts(value: unknown, into: string[] = []): string[] {
  const address = asEvmAddress(value);
  if (address) {
    if (!into.includes(address)) into.push(address);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEvmAccounts(item, into);
    return into;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectEvmAccounts(item, into);
  }
  return into;
}

export function collectPosAccounts(value: unknown, into: string[] = []): string[] {
  const address = asPosAddress(value);
  if (address) {
    if (!into.includes(address)) into.push(address);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPosAccounts(item, into);
    return into;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectPosAccounts(item, into);
  }
  return into;
}

/** The Onchain wallet may return one address string, a list, or the selected account beside an empty one. */
export function orderCronosAccounts(result: unknown, selected?: string | null): string[] {
  const found: string[] = [];
  const push = (value: unknown) => {
    for (const address of collectEvmAccounts(value)) {
      if (!found.includes(address)) found.push(address);
    }
  };
  push(selected);
  push(result);
  return found;
}

export function preferFundedAccount<T extends { sol: number; wcro?: number; usdc: number; posCro?: number }>(
  rows: Array<{ account: string; bal: T }>,
): string {
  if (!rows.length) throw new Error("Wallet connected but did not return an account.");
  const evm = (bal: T) => bal.sol + (bal.wcro ?? 0);
  const total = (bal: T) => evm(bal) + bal.usdc + (bal.posCro ?? 0);
  const armable = rows.filter((row) => evm(row.bal) >= 3 || row.bal.usdc >= 1);
  const pool = armable.length ? armable : rows;
  return pool.reduce((best, row) => (total(row.bal) > total(best.bal) ? row : best)).account;
}

function bech32Polymod(values: number[]): number {
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= BECH32_GEN[i]!;
    }
  }
  return chk;
}

function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const max = (1 << to) - 1;
  const out: number[] = [];
  for (const value of data) {
    if (value < 0 || value >> from) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }
  }
  if (pad) {
    if (bits) out.push((acc << (to - bits)) & max);
  } else if (bits >= from || ((acc << (to - bits)) & max)) {
    return null;
  }
  return out;
}

function bech32HrpExpand(hrp: string): number[] {
  return [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
}

/** Cronos EVM `0x…` and Cronos POS `cro1…` are the same 20 bytes. */
export function evmToCroPos(address: string, hrp = "cro"): string | null {
  const evm = asEvmAddress(address);
  if (!evm || (hrp !== "cro" && hrp !== "tcro")) return null;
  const bytes: number[] = [];
  for (let i = 2; i < evm.length; i += 2) bytes.push(Number.parseInt(evm.slice(i, i + 2), 16));
  const data = convertBits(bytes, 8, 5, true);
  if (!data) return null;
  const mod = bech32Polymod([...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum: number[] = [];
  for (let i = 0; i < 6; i += 1) checksum.push((mod >> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...checksum].map((value) => BECH32[value]).join("")}`;
}

/** Cronos POS `cro1…` and Cronos EVM `0x…` are the same 20 bytes. */
export function croPosToEvm(address: string): string | null {
  const raw = address.trim();
  const split = raw.lastIndexOf("1");
  if (split < 1) return null;
  const hrp = raw.slice(0, split).toLowerCase();
  if (hrp !== "cro" && hrp !== "tcro") return null;
  const body = raw.slice(split + 1).toLowerCase();
  const values: number[] = [];
  for (const ch of body) {
    const idx = BECH32.indexOf(ch);
    if (idx < 0) return null;
    values.push(idx);
  }
  if (values.length < 6) return null;
  if (bech32Polymod([...bech32HrpExpand(hrp), ...values]) !== 1) return null;
  const bytes = convertBits(values.slice(0, -6), 5, 8, false);
  if (!bytes || bytes.length < 20) return null;
  const hex = bytes
    .slice(-20)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  try {
    return getAddress(`0x${hex}`);
  } catch {
    return null;
  }
}

export function parseRpcQuantity(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    if (value > 1e12) return BigInt(Math.trunc(value));
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n) && n > 1e12) return BigInt(Math.trunc(n));
      return null;
    }
    try {
      const wei = BigInt(trimmed);
      return wei >= 0n ? wei : null;
    } catch {
      return null;
    }
  }
  if (value && typeof value === "object") {
    const record = value as { result?: unknown; hex?: unknown; value?: unknown };
    return parseRpcQuantity(record.result ?? record.hex ?? record.value);
  }
  return null;
}
