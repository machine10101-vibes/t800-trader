import { bookTokens } from "@/lib/market/universe";
import type { ChainId } from "@/lib/chain";

export interface LandingToken {
  symbol: string;
  name: string;
  mint: string;
  chain: ChainId;
  sector: string;
}

const MARK: Record<string, string> = {
  SOL: "sol.png",
  ZBCN: "zbcn.jpg",
  PUMP: "pump.jpg",
  ZEC: "zec.png",
  RAY: "ray.jpg",
  CRO: "cro.png",
  ULTCAT: "ultcat.png",
  CRIMECAT: "crimecat.svg",
  MERY: "mery.png",
  PACK: "pack.png",
  ULTI: "ulti.png",
};

/** Every name the desk actually trades, Solana book then Cronos book. */
export function landingTokens(): LandingToken[] {
  return (["solana", "cronos"] as const).flatMap((chain) =>
    bookTokens(chain).map((token) => ({
      symbol: token.symbol,
      name: token.name,
      mint: token.mint,
      chain,
      sector: token.sector,
    })),
  );
}

/** Alternate the two books so the ring does not clump one chain. */
export function landingOrbit(): LandingToken[] {
  const all = landingTokens();
  const sol = all.filter((token) => token.chain === "solana");
  const cro = all.filter((token) => token.chain === "cronos");
  const mixed: LandingToken[] = [];
  const count = Math.max(sol.length, cro.length);
  for (let i = 0; i < count; i += 1) {
    if (sol[i]) mixed.push(sol[i]);
    if (cro[i]) mixed.push(cro[i]);
  }
  return mixed;
}

/** Local mark shipped with the site, so the ring does not wait on a price feed. */
export function landingMark(symbol: string): string | null {
  const file = MARK[symbol.toUpperCase()];
  return file ? `/t800-trader/logos/tokens/${file}` : null;
}
