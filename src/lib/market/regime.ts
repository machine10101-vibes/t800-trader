import type { ChainId } from "@/lib/chain";
import type { MarketRegime } from "@/lib/types";

export interface RegimeMark {
  price: number;
  change24h: number;
  marketCap: number;
  volume24h: number;
}

export interface RegimeFacts {
  chain: ChainId;
  btc: RegimeMark;
  eth: RegimeMark;
  l1: RegimeMark;
  btcDom: number | null;
  fear: { value: number; label: string } | null;
  tvl: number | null;
  dexVolume24h: number | null;
  dexChange1d: number | null;
}

function money(n: number): string {
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

/**
 * Words on the charts board. Solana keeps SOL / Solana DEX copy.
 * Cronos only talks about CRO, Cronos TVL, and Cronos DEX flow.
 */
export function paintRegime(facts: RegimeFacts): Pick<
  MarketRegime,
  "stance" | "stanceWhy" | "crowded" | "overlooked" | "overview" | "narratives"
> {
  const cronos = facts.chain === "cronos";
  const l1 = cronos ? "CRO" : "SOL";
  const venues = cronos ? "Cronos" : "Solana";
  const btcPx = facts.btc.price > 0 ? facts.btc.price : null;
  const l1Px = facts.l1.price > 0 ? facts.l1.price : null;
  const fearValue = facts.fear?.value ?? null;
  const vsBtc = facts.l1.change24h - facts.btc.change24h;
  const riskOn =
    Boolean(btcPx && l1Px) &&
    facts.btc.change24h > 0.4 &&
    facts.l1.change24h > 0 &&
    (fearValue === null || fearValue >= 45) &&
    (facts.dexChange1d === null || facts.dexChange1d > -8);
  const defensive =
    Boolean(btcPx || l1Px) && (facts.btc.change24h < -2 || (fearValue !== null && fearValue < 30) || facts.l1.change24h < -5);
  const stance: MarketRegime["stance"] = !btcPx && !l1Px ? "mixed" : defensive ? "defensive" : riskOn ? "risk-on" : "mixed";

  const crowded: string[] = [];
  const overlooked: string[] = [];
  if (fearValue !== null && fearValue >= 70) crowded.push("High-beta memes (Fear & Greed in greed)");
  else if (fearValue !== null) {
    overlooked.push(
      cronos
        ? "Selective high-beta Cronos names while sentiment is not euphoric"
        : "Selective high-beta Solana names while sentiment is not euphoric",
    );
  }
  if (btcPx && l1Px && vsBtc > 2) crowded.push(`${l1} beta / ecosystem rotation vs BTC`);
  else if (btcPx && l1Px && vsBtc < -2) overlooked.push(`${venues} beta vs BTC (${l1} underperforming on the day)`);
  if (facts.dexChange1d !== null && facts.dexChange1d > 15) crowded.push(`${venues} DEX volume chase`);
  else if (facts.dexChange1d !== null) {
    overlooked.push(
      cronos ? "Cronos DEX flow that is not exploding day-over-day" : "Spot DEX flow that is not exploding day-over-day",
    );
  }
  crowded.push(cronos ? "Boosted or launchpad Cronos tape" : "Paid Dexscreener boosts / launchpad tape");
  overlooked.push(
    cronos ? "Liquid WolfSwap, VVS, and cro.trade books with measurable usage" : "Fee-switch / LST / perps venues with measurable usage",
  );

  const stanceWhy =
    !btcPx && !l1Px
      ? `BTC/${l1} marks are missing this cycle. Stance is withheld — no fabricated tape.`
      : stance === "defensive"
        ? `BTC or ${l1} is selling off, or sentiment is fearful — size down and demand cleaner setups.`
        : stance === "risk-on"
          ? `BTC and ${l1} are green with non-panicked sentiment — short-term longs have a tailwind.`
          : cronos
            ? "Tape is mixed. Prefer liquid Cronos names, tight risk, and fade only extreme extensions."
            : "Tape is mixed. Prefer liquid names, tight risk, and fade only extreme extensions.";

  const overview = [
    `BTC ${btcPx ? `$${facts.btc.price.toLocaleString()} (${facts.btc.change24h.toFixed(2)}%)` : "n/a"}, ETH ${facts.eth.price ? `$${facts.eth.price.toLocaleString()} (${facts.eth.change24h.toFixed(2)}%)` : "n/a"}, ${l1} ${l1Px ? `${money(facts.l1.price)} (${facts.l1.change24h.toFixed(2)}%)` : "n/a"}.`,
    facts.btcDom !== null ? `BTC dominance ${facts.btcDom.toFixed(1)}%.` : "BTC dominance unavailable.",
    facts.fear ? `Fear & Greed ${facts.fear.value} (${facts.fear.label}).` : "Fear & Greed unavailable.",
    facts.tvl !== null ? `${venues} DeFi TVL $${(facts.tvl / 1e9).toFixed(2)}B.` : `${venues} TVL unavailable.`,
    facts.dexVolume24h !== null
      ? `${venues} DEX volume 24h $${(facts.dexVolume24h / 1e9).toFixed(2)}B (${facts.dexChange1d !== null ? `${facts.dexChange1d.toFixed(1)}% d/d` : "d/d n/a"}).`
      : `${venues} DEX volume unavailable.`,
    stanceWhy,
  ].join(" ");

  const narratives =
    stance === "risk-on"
      ? cronos
        ? ["CRO beta", "WolfSwap / VVS flow", "Selective memes only with liquidity"]
        : ["SOL beta", "DEX flow", "Selective memes only with liquidity"]
      : stance === "defensive"
        ? cronos
          ? ["Capital preservation", "CRO/USDC only", "Avoid illiquid launches"]
          : ["Capital preservation", "SOL/USDC only", "Avoid illiquid launches"]
        : cronos
          ? ["Liquid Cronos names", "Mean-reversion fades", "Research over tape-chasing"]
          : ["Liquid majors", "Mean-reversion fades", "Research over tape-chasing"];

  return { stance, stanceWhy, crowded, overlooked, overview, narratives };
}
