import { bookTokens } from "@/lib/market/universe";
import { CHAIN_IDS, type ChainId } from "@/lib/chain";

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
  DASH: "dash.png",
  NEAR: "near.jpg",
  ETH: "eth.png",
  QTC: "qtc.svg",
  RHEA: "rhea.svg",
  ULTCAT: "ultcat.png",
  CRIMECAT: "crimecat.svg",
  MERY: "mery.png",
  PACK: "pack.png",
  ULTI: "ulti.png",
};

/** Every name the desk actually trades, one chain after another. */
export function landingTokens(): LandingToken[] {
  return CHAIN_IDS.flatMap((chain) =>
    bookTokens(chain).map((token) => ({
      symbol: token.symbol,
      name: token.name,
      mint: token.mint,
      chain,
      sector: token.sector,
    })),
  );
}

/** Alternate the books so the ring does not clump one chain. */
export function landingOrbit(): LandingToken[] {
  const all = landingTokens();
  const groups = CHAIN_IDS.map((chain) => all.filter((token) => token.chain === chain));
  const mixed: LandingToken[] = [];
  const count = Math.max(...groups.map((group) => group.length));
  for (let i = 0; i < count; i += 1) {
    for (const group of groups) {
      if (group[i]) mixed.push(group[i]);
    }
  }
  return mixed;
}

/** Local mark shipped with the site, so the ring does not wait on a price feed. */
export function landingMark(symbol: string): string | null {
  const file = MARK[symbol.toUpperCase()];
  return file ? `/t800-trader/logos/tokens/${file}` : null;
}
