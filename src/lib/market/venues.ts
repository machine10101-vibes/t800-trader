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

export const DEFAULT_VENUES: string[] = VENUE_OPTIONS.map((v) => v.id);

const KNOWN: { id: string; test: (dex: string) => boolean }[] = [
  { id: "vvs", test: (dex) => dex === "vvs" || dex.startsWith("vvs-") },
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

export function venueLabel(id: string): string {
  if (id === "vvs") return "VVS Finance";
  return VENUE_OPTIONS.find((venue) => venue.id === id)?.label ?? id;
}

export function venueSummary(ids: string[]): string {
  if (!ids.length) return "no venue";
  if (ids.length >= VENUE_OPTIONS.length && VENUE_OPTIONS.every((venue) => ids.includes(venue.id))) return "all venues";
  return VENUE_OPTIONS.filter((venue) => ids.includes(venue.id))
    .map((venue) => venue.label)
    .join(", ");
}

/** Drop unknown ids. Missing input means the shipped default (every venue). An empty list stays empty. */
export function normalizeVenues(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_VENUES];
  const allowed = new Set(VENUE_OPTIONS.map((venue) => venue.id));
  const out: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || !allowed.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

export function venueAllowed(dex: string, venues: string[] | undefined): boolean {
  if (!venues) return true;
  if (!venues.length) return false;
  return venues.includes(venueForDex(dex));
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
  if (VENUE_OPTIONS.every((venue) => venues.includes(venue.id))) return null;
  const labels = venues.flatMap((id) => JUPITER_DEXES[id] ?? []);
  return labels.length ? labels : null;
}
