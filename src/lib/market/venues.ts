import type { ChainId } from "@/lib/chain";

/** Platforms the desk can trade. GeckoTerminal dex ids fold into these. */
export interface VenueOption {
  id: string;
  label: string;
  hint: string;
}

export const VENUE_OPTIONS: VenueOption[] = [
  {
    id: "raydium",
    label: "Raydium",
    hint: "Raydium AMM and CLMM pools.",
  },
  {
    id: "orca",
    label: "Orca",
    hint: "Orca Whirlpool pools.",
  },
  {
    id: "meteora",
    label: "Meteora",
    hint: "Meteora DLMM, DAMM, and dynamic pools.",
  },
  {
    id: "jupiter",
    label: "Jupiter",
    hint: "Pools whose venue is Jupiter. Router flow still lands on Raydium, Orca, or Meteora.",
  },
  {
    id: "pump",
    label: "Pump.fun",
    hint: "Pump.fun and PumpSwap launch pools.",
  },
  {
    id: "other",
    label: "Other venues",
    hint: "Phoenix, Lifinity, Manifest, and any pool that is not one of the venues above.",
  },
];

export const CRONOS_VENUE_OPTIONS: VenueOption[] = [
  {
    id: "wolfswap",
    label: "WolfSwap",
    hint: "Quotes WolfSwap. A buy or sell is sent here when this quote is the best of the places that are on.",
  },
  {
    id: "vvs",
    label: "VVS Finance",
    hint: "Quotes the VVS router. The desk sends that swap when VVS returns more than the other places that are on.",
  },
  {
    id: "crotrade",
    label: "cro.trade",
    hint: "Uses the VVS quote after cro.trade's 0.9% fee. Sent when that net amount beats the other places that are on.",
  },
];

export const DEFAULT_VENUES: string[] = VENUE_OPTIONS.map((v) => v.id);
export const DEFAULT_CRONOS_VENUES: string[] = CRONOS_VENUE_OPTIONS.map((v) => v.id);

export type CronosVenueId = "wolfswap" | "vvs" | "crotrade";

const SOLANA_IDS = new Set(DEFAULT_VENUES);
const CRONOS_IDS = new Set(DEFAULT_CRONOS_VENUES);
const ALL_IDS = new Set([...DEFAULT_VENUES, ...DEFAULT_CRONOS_VENUES]);

const KNOWN: { id: string; test: (dex: string) => boolean }[] = [
  { id: "vvs", test: (dex) => dex === "vvs" || dex.startsWith("vvs-") },
  { id: "wolfswap", test: (dex) => dex.includes("wolf") },
  { id: "crotrade", test: (dex) => dex.includes("crotrade") || dex.includes("cro.trade") || dex.includes("cro-trade") },
  { id: "raydium", test: (dex) => dex.startsWith("raydium") },
  { id: "orca", test: (dex) => dex === "orca" || dex.includes("whirlpool") },
  { id: "meteora", test: (dex) => dex.startsWith("meteora") },
  { id: "jupiter", test: (dex) => dex.startsWith("jupiter") },
  { id: "pump", test: (dex) => dex.includes("pump") },
];

export function venueForDex(dex: string): string {
  const id = dex.toLowerCase();
  return KNOWN.find((venue) => venue.test(id))?.id ?? "other";
}

export function isCronosVenue(id: string): id is CronosVenueId {
  return CRONOS_IDS.has(id);
}

export function venueOptionsFor(chain: ChainId): VenueOption[] {
  return chain === "cronos" ? CRONOS_VENUE_OPTIONS : VENUE_OPTIONS;
}

export function venueLabel(id: string): string {
  const cronos = CRONOS_VENUE_OPTIONS.find((venue) => venue.id === id);
  if (cronos) return cronos.label;
  return VENUE_OPTIONS.find((venue) => venue.id === id)?.label ?? id;
}

/**
 * Older Cronos books stored Solana venue ids. Those still mean every Cronos DEX is on.
 * An empty list is an explicit all-off.
 */
export function cronosVenuesOn(venues?: string[]): CronosVenueId[] {
  if (!venues) return [...DEFAULT_CRONOS_VENUES] as CronosVenueId[];
  const picked = venues.filter(isCronosVenue);
  if (picked.length) return picked;
  if (!venues.length) return [];
  if (venues.some((id) => SOLANA_IDS.has(id))) return [...DEFAULT_CRONOS_VENUES] as CronosVenueId[];
  return [];
}

export function venuesOnFor(venues: string[] | undefined, chain: ChainId): string[] {
  return chain === "cronos" ? cronosVenuesOn(venues) : (venues ?? [...DEFAULT_VENUES]);
}

export function venueSummary(ids: string[], chain: ChainId = "solana"): string {
  const options = venueOptionsFor(chain);
  const selected = chain === "cronos" ? cronosVenuesOn(ids) : ids;
  if (!selected.length) return "no venue";
  const labels = options.filter((venue) => selected.includes(venue.id)).map((venue) => venue.label);
  if (!labels.length) return "no venue";
  if (options.every((venue) => selected.includes(venue.id))) return "all venues";
  return labels.join(", ");
}

/** Drop unknown ids. Missing input means the shipped Solana default. An empty list stays empty. */
export function normalizeVenues(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_VENUES];
  const out: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || !ALL_IDS.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

export function venueAllowed(dex: string, venues: string[] | undefined): boolean {
  if (!venues) return true;
  if (!venues.length) return false;
  return venues.includes(venueForDex(dex));
}

export function cronosVenueFlags(venues?: string[]): Record<CronosVenueId, boolean> {
  const on = new Set(cronosVenuesOn(venues));
  return {
    wolfswap: on.has("wolfswap"),
    vvs: on.has("vvs"),
    crotrade: on.has("crotrade"),
  };
}

const JUPITER_DEXES: Record<string, string[]> = {
  raydium: ["Raydium", "Raydium CLMM", "Raydium CP", "Raydium Launchlab"],
  orca: ["Whirlpool", "Orca V1", "Orca V2"],
  meteora: ["Meteora", "Meteora DLMM", "Meteora DAMM v2", "Dynamic Bonding Curve"],
  jupiter: ["JupiterRfqV2"],
  pump: ["Pump.fun", "Pump.fun Amm"],
  other: ["Phoenix", "OpenBook V2", "Manifest", "FluxBeam", "Invariant"],
};

/** Null means Jupiter may use any pool. A list restricts the signed swap to those venues. */
export function dexesForVenues(venues: string[] | undefined): string[] | null {
  if (!venues?.length) return null;
  const sol = venues.filter((id) => SOLANA_IDS.has(id));
  if (!sol.length) return null;
  if (VENUE_OPTIONS.every((venue) => sol.includes(venue.id))) return null;
  const labels = sol.flatMap((id) => JUPITER_DEXES[id] ?? []);
  return labels.length ? labels : null;
}
