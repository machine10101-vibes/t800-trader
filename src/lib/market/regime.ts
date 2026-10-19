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

export interface TapeInput {
  btcChange24h: number;
  ethChange24h: number;
  l1Change24h: number;
  fearGreed: number | null;
  dexChange1d?: number | null;
  /** When false, Bitcoin and the chain coin have no price, so the stance is withheld. */
  priced?: boolean;
}

/** Bitcoin carries three quarters of this blend, Ethereum the rest. */
export function majorsPerformancePct(btcChange24h: number, ethChange24h: number): number {
  return btcChange24h * 0.75 + ethChange24h * 0.25;
}

/**
 * Bitcoin and Ethereum are both red, the blend is softer than a 1.5% decline, and
 * Fear & Greed is calm (45–74). Longs opened on that tape lost in both replay windows.
 * A harder selloff is already defensive. Greed and uneasy readings stay tradable.
 */
export function quietRedMarket(input: Pick<TapeInput, "btcChange24h" | "ethChange24h" | "fearGreed">): boolean {
  const fear = input.fearGreed;
  if (fear === null || fear < 45 || fear >= 75) return false;
  if (!(input.btcChange24h < 0 && input.ethChange24h < 0)) return false;
  return majorsPerformancePct(input.btcChange24h, input.ethChange24h) > -1.5;
}

/** One stance for the live desks and the candle replay. */
export function tapeStance(input: TapeInput): MarketRegime["stance"] {
  if (input.priced === false) return "mixed";
  const fear = input.fearGreed;
  const dex = input.dexChange1d ?? null;
  const riskOn =
    input.btcChange24h > 0.4 &&
    input.l1Change24h > 0 &&
    (fear === null || fear >= 45) &&
    (dex === null || dex > -8);
  const defensive =
    input.btcChange24h < -2 ||
    (fear !== null && fear < 30) ||
    input.l1Change24h < -5 ||
    quietRedMarket(input);
  return defensive ? "defensive" : riskOn ? "risk-on" : "mixed";
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
  const tape = {
    btcChange24h: facts.btc.change24h,
    ethChange24h: facts.eth.change24h,
    l1Change24h: facts.l1.change24h,
    fearGreed: fearValue,
    dexChange1d: facts.dexChange1d,
    priced: Boolean(btcPx || l1Px),
  };
  const stance = tapeStance(tape);
  const quietRed = stance === "defensive" && quietRedMarket(tape);

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
      : quietRed
        ? `Bitcoin and Ethereum are both red and Fear & Greed is calm (${fearValue}). A quiet red market stands down.`
        : stance === "defensive"
          ? `BTC or ${l1} is selling off, or sentiment is fearful — size down and demand cleaner setups.`
        : stance === "risk-on"
          ? `BTC and ${l1} are green with non-panicked sentiment — short-term longs have a tailwind.`
          : cronos
            ? "Tape is mixed. Prefer liquid Cronos names, tight risk, and fade only extreme extensions."
            : "Tape is mixed. Prefer liquid names, tight risk, and fade only extreme extensions.";

  const broad =
    btcPx && facts.eth.price > 0
      ? `Broad market ${majorsPerformancePct(facts.btc.change24h, facts.eth.change24h).toFixed(2)}% (three parts Bitcoin, one part Ethereum).`
      : "Broad market unavailable.";
  const overview = [
    `BTC ${btcPx ? `$${facts.btc.price.toLocaleString()} (${facts.btc.change24h.toFixed(2)}%)` : "n/a"}, ETH ${facts.eth.price ? `$${facts.eth.price.toLocaleString()} (${facts.eth.change24h.toFixed(2)}%)` : "n/a"}, ${l1} ${l1Px ? `${money(facts.l1.price)} (${facts.l1.change24h.toFixed(2)}%)` : "n/a"}.`,
    broad,
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
