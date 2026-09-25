import type { ChainId } from "@/lib/chain";
import { sameMint } from "@/lib/chain";
import { cachedOhlcv, loadMarket } from "@/lib/market/providers";
import { tapeRead } from "@/lib/market/tape";
import { isActiveBook, SOL_MINT, WCRO_MINT, ZBCN_MINT } from "@/lib/market/universe";
import { venueForDex, venueLabel, venueSummary } from "@/lib/market/venues";
import type {
  BotConfig,
  Catalyst,
  MarketRegime,
  ResearchThesis,
  ScoredCandidate,
  TechnicalSnapshot,
  TokenCandidate,
} from "@/lib/types";
import { snapshotTechnical, technicalFromFlows } from "@/lib/trading/signals";
import { usd } from "@/lib/utils";
import { scoreCandidate, screenCandidate } from "./scoring";

function canTake(out: ScoredCandidate[], item: ScoredCandidate, maxMeme: number, maxUnknown: number): boolean {
  if (out.some((x) => x.mint === item.mint)) return false;
  const count = (sector: string) => out.filter((x) => x.sector === sector).length;
  if (item.sector === "Meme" && count("Meme") >= maxMeme) return false;
  if (item.sector === "Unknown" && count("Unknown") >= maxUnknown) return false;
  if (item.sector !== "Meme" && item.sector !== "Unknown" && count(item.sector) >= 3) return false;
  return true;
}

function pickFinalists(items: ScoredCandidate[], maxMeme = 2): ScoredCandidate[] {
  const ranked = [...items].sort((a, b) => b.researchScore - a.researchScore);
  const watch = ranked.filter((c) => c.watchlist);
  const rest = ranked.filter((c) => !c.watchlist);
  const out: ScoredCandidate[] = [];
  for (const item of watch) {
    if (canTake(out, item, Math.min(maxMeme, 1), 0)) out.push(item);
    if (out.length >= 6) break;
  }
  for (const item of rest) {
    if (out.length >= 8) break;
    if (canTake(out, item, maxMeme, 1)) out.push(item);
  }
  return out.slice(0, 8);
}

function catalystsFor(c: ScoredCandidate): Catalyst[] {
  const list: Catalyst[] = [];
  if (c.watchlist) {
    list.push({
      window: "30d",
      title: "Ongoing venue usage",
      status: "confirmed",
      detail: "Watchlist protocol with live Solana pools. Near-term catalyst is continued fee/volume share, not a rumor.",
    });
    list.push({
      window: "1-3m",
      title: "Ecosystem flow if SOL beta holds",
      status: "speculative",
      detail: "If SOL stays bid, liquid ecosystem names usually re-rate together. This is beta, not a unique unlock.",
    });
  } else {
    list.push({
      window: "30d",
      title: "Tape and liquidity persistence",
      status: "confirmed",
      detail: "The only confirmed near-term catalyst in public pool data is whether volume and reserves persist after the move.",
    });
    list.push({
      window: "1-3m",
      title: "Narrative follow-through",
      status: "speculative",
      detail: "No official roadmap event is ingested by this desk. Treat listings, 'partnerships', and social claims as unconfirmed.",
    });
  }
  list.push({
    window: "3-6m",
    title: "Token value capture",
    status: "speculative",
    detail: "Fee switches, buybacks, or staking claims are not verified here unless they already show up in usage metrics.",
  });
  list.push({
    window: "6-12m",
    title: "Competitive share",
    status: "speculative",
    detail: "Longer-dated edge depends on whether users stay after incentives. This feed cannot prove that yet.",
  });
  return list;
}

function thesisFrom(c: ScoredCandidate, regime: MarketRegime): ResearchThesis {
  const mc = c.marketCapUsd;
  const fdv = c.fdvUsd;
  const volMc = mc && mc > 0 ? c.volume24hUsd / mc : null;
  const buyShare =
    c.flows.h24.buys + c.flows.h24.sells > 0 ? c.flows.h24.buys / (c.flows.h24.buys + c.flows.h24.sells) : null;
  const missing: string[] = [];
  if (mc === null) missing.push("Circulating market cap");
  if ((c.sector === "LST" || c.sector === "Perps" || c.sector === "Lending") && !(c.apyPct && c.apyPct > 0)) {
    missing.push("Confirmed APY for this mint");
  }
  if (fdv === null) missing.push("FDV");
  missing.push("Official unlock / vesting schedule");
  missing.push("Protocol revenue / token fee switch");
  missing.push("Holder concentration and insider wallets");
  missing.push("Audited token utility beyond pool tape");

  const path =
    c.mint === SOL_MINT
      ? "A confirmed long is a Jupiter perp at 5x, or 10x when the signal is strong, once the key has $10. Below that it is a spot bid."
      : c.mint === ZBCN_MINT
        ? "A confirmed long is 5x, or 10x when the signal is strong, once the key has $10. Jupiter lists no ZBCN perp, so that collateral is a Zebec spot bag and the ticket is marked at the multiplier. Below $10 it is a spot bid."
        : sameMint(c.mint, WCRO_MINT)
          ? "A confirmed long is 5x, or 10x when the signal is strong, once the key has $10. This desk has no CRO perp, so that collateral is a CRO spot bag and the ticket is marked at the multiplier. Below $10 it is a spot bid."
          : "A confirmed long is a spot bid.";
  const coreThesis = `${tapeRead(c.symbol, c.flows.m5.priceChangePct, c.flows.m15.priceChangePct, c.flows.h1.priceChangePct)} ${techLine(c)} ${path} Reserves ${usd(c.liquidityUsd)}, 24h volume ${usd(c.volume24hUsd)}.`;

  const m15Now = c.flows.m15.priceChangePct;
  const fifteen = m15Now < 0 ? "red" : m15Now < 0.1 ? "flat" : "green";
  const whyMispriced =
    fifteen === "green"
      ? `${c.symbol} has ${usd(c.volume24hUsd)} of 24h volume while the 15m is already green. The long is that continuation with a stop. It is not a claim that the token is cheap versus a model.`
      : `${c.symbol} still has ${usd(c.liquidityUsd)} in reserves and ${usd(c.volume24hUsd)} of 24h volume, and the 15m tape is ${fifteen}. A red or flat chart is not a discount. The book waits for a green 15m.`;

  const fundamental = [
    `Pool on ${venueLabel(venueForDex(c.dex))} (${c.dex}), quoted vs ${c.quoteSymbol}.`,
    c.watchlist ? "Mapped to a known Solana protocol on the internal watchlist." : "Not on the conservative watchlist — treat as tape-first.",
    `24h unique takers ${ (c.flows.h24.buyers + c.flows.h24.sellers).toLocaleString() }.`,
    mc ? `Reported market cap ${usd(mc)}.` : "Market cap not published by GeckoTerminal for this pool.",
    c.apyPct && c.apyPct > 0
      ? `Live APY ${c.apyPct.toFixed(2)}% from ${c.apySources?.join(", ") || "a public yield feed"}.`
      : null,
  ].filter((line): line is string => Boolean(line));

  const onchain = [
    `24h pool volume ${usd(c.volume24hUsd)} against reserves ${usd(c.liquidityUsd)}.`,
    buyShare !== null ? `24h buy share of fills ${(buyShare * 100).toFixed(1)}%.` : "Buy/sell mix unavailable.",
    `1h change ${c.flows.h1.priceChangePct.toFixed(2)}% on ${usd(c.flows.h1.volumeUsd)} volume.`,
    c.ageHours !== null ? `Oldest observed pool age ${c.ageHours.toFixed(1)} hours.` : "Pool age unavailable.",
    techLine(c),
    c.priceAgreement === "split"
      ? "Independent price feeds disagree. The desk keeps the GeckoTerminal mark and will not open a new ticket on it."
      : c.priceAgreement === "agree"
        ? `Mark cross-checked by ${c.sources.filter((s) => s.endsWith(":price") || s.endsWith(":jlp-price")).join(", ")}.`
        : null,
  ].filter((line): line is string => Boolean(line));

  const tokenomics = [
    fdv && mc ? `FDV ${usd(fdv)} vs circulating ${usd(mc)} (${(fdv / mc).toFixed(2)}x).` : "FDV/circ not fully available.",
    "Unlock calendars, insider allocations, and emissions are not in the public feeds this bot uses. Do not invent them.",
    c.sector === "Meme"
      ? "Meme tokens rarely have economic value capture. Size as a scalp, never as a fundamental long."
      : "Even for functional venues, token value capture is unproven unless fees or buybacks are independently verified.",
  ].join(" ");

  const relative =
    volMc !== null
      ? `Volume/MC ${(volMc * 100).toFixed(2)}%. Compare only against other Solana ${c.sector} names, not against BTC. High turnover can mean healthy flow or a mercenary crowd — pair it with unique takers and reserve depth.`
      : `Market cap missing, so MC/Revenue and MC/TVL are not computed. Fallback: reserves ${usd(c.liquidityUsd)} vs 24h volume ${usd(c.volume24hUsd)}.`;

  const competitive = c.watchlist
    ? `${c.name} competes with other Solana ${c.sector} venues. Advantage, if any, is existing liquidity and ticker recognition — both are copyable. A faster incentive program or a better product fork can take flow in weeks.`
    : `${c.symbol} has no demonstrated moat in this dataset. Competitors are every other launch with deeper liquidity or a more credible float.`;

  const bull = `${c.symbol} 15m stays green, the 5m holds its short average, and reserves stay near ${usd(c.liquidityUsd)}. Regime is ${regime.stance}. ${path}`;
  const base = `The 15m chops around flat. The bot skips until that window is green and the 5m agrees, then takes one ticket.`;
  const bear = `The 15m stays red, or reserves fall under $${Math.max(80_000, c.liquidityUsd * 0.45).toFixed(0)}. No new long. An open ticket scratches when the 5m and the 15m both flip.`;

  return {
    id: c.mint,
    ticker: c.symbol,
    asset: c.name,
    price: c.priceUsd,
    marketCap: c.marketCapUsd,
    fdv: c.fdvUsd,
    sector: c.sector,
    coreThesis,
    whyMispriced,
    fundamentalEvidence: fundamental,
    onchainEvidence: onchain,
    tokenomics,
    relativeValuation: relative,
    competitivePositioning: competitive,
    catalysts: catalystsFor(c),
    keyCatalyst: catalystsFor(c)[0]?.title ?? "Liquidity persistence",
    biggestRisk:
      c.penalties[0] ||
      (c.sector === "Meme" ? "Narrative + insider tape, no value capture" : "Token does not capture protocol success"),
    keyMetric: `${c.keyMetric} ${c.keyMetricValue}`,
    researchScore: c.researchScore,
    bullCase: bull,
    baseCase: base,
    bearCase: bear,
    invalidation: [
      `Reserves fall below $${Math.max(80_000, c.liquidityUsd * 0.45).toFixed(0)}`,
      "Unique 24h takers collapse by >60% while price is still elevated",
      "One-sided sell share >70% for two consecutive hours",
      "Bot daily loss limit hit — no new risk until the next session",
    ],
    monitor: [
      "Pool reserves and 5m/1h volume",
      "Buy/sell and buyer/seller mix",
      "5m RSI / EMA stack / VWAP extension",
      "SOL beta and BTC dominance",
      "Any verified unlock or fee-switch announcement (not social rumors)",
    ],
    sources: [
      ...c.sources,
      "https://api.geckoterminal.com",
      "https://api.coingecko.com",
      "https://api.llama.fi",
      "https://api.alternative.me/fng",
    ],
    missingData: missing,
    candidate: c,
  };
}

function techLine(c: ScoredCandidate): string {
  const t = c.technical;
  const bits = [
    t.rsi14 !== null ? `RSI14 ${t.rsi14.toFixed(1)}` : null,
    t.ema9 !== null && t.ema21 !== null
      ? `EMA9/21 ${t.ema9 > t.ema21 ? "bull" : t.ema9 < t.ema21 ? "bear" : "flat"}`
      : null,
    t.extensionPct !== null ? `VWAP ext ${t.extensionPct.toFixed(2)}%` : null,
    t.atrPct !== null ? `ATR ${t.atrPct.toFixed(2)}%` : null,
  ].filter(Boolean);
  return bits.length ? `5m structure: ${bits.join(", ")}.` : "5m structure unavailable this cycle.";
}

interface ResearchValue {
  regime: MarketRegime;
  research: ResearchThesis[];
  universeSize: number;
  eliminated: number;
  candidates: ScoredCandidate[];
}

const researchCache: Record<ChainId, { at: number; key: string; value: ResearchValue } | null> = {
  solana: null,
  cronos: null,
};

const RESEARCH_CACHE_MS = 20_000;

function structureFor(candidate: TokenCandidate): TechnicalSnapshot {
  const candles = cachedOhlcv(candidate.poolAddress);
  if (candles && candles.length >= 20) return snapshotTechnical(candles);
  return technicalFromFlows(candidate);
}

export function clearResearchCache(chain?: ChainId): void {
  if (!chain) {
    researchCache.solana = null;
    researchCache.cronos = null;
    return;
  }
  researchCache[chain] = null;
}

export async function runResearch(
  config: BotConfig,
  force = false,
  chain: ChainId = "solana",
): Promise<ResearchValue> {
  const key = `${chain}|${screenKey(config)}`;
  const cached = researchCache[chain];
  if (!force && cached && cached.key === key && Date.now() - cached.at < RESEARCH_CACHE_MS) {
    return cached.value;
  }
  const market = await loadMarket(false, chain);
  const screen = {
    minLiquidityUsd: config.minLiquidityUsd,
    minVolume24hUsd: config.minVolume24hUsd,
    minAgeHours: config.minAgeHours,
    allowMemes: config.allowMemes,
    venues: chain === "cronos" ? ["vvs"] : config.venues,
  };

  const passed: TokenCandidate[] = [];
  let eliminated = 0;
  const book = market.candidates.filter((c) => isActiveBook(c.mint, chain));
  for (const c of book) {
    if (screenCandidate(c, screen)) {
      eliminated += 1;
      continue;
    }
    passed.push(c);
  }
  const unique = collapseMints(passed);

  const watchPassed = unique.filter((c) => c.watchlist);
  const otherPassed = unique
    .filter((c) => !c.watchlist)
    .map((c) => ({ c, heat: c.volume24hUsd + c.liquidityUsd * 2 }))
    .sort((a, b) => b.heat - a.heat)
    .map((x) => x.c);
  const seen = new Set<string>();
  const rankedSeed: TokenCandidate[] = [];
  const pushSeed = (row: TokenCandidate) => {
    if (seen.has(row.mint)) return;
    seen.add(row.mint);
    rankedSeed.push(row);
  };
  for (const row of watchPassed) pushSeed(row);
  for (const row of otherPassed) {
    if (row.sector !== "Unknown" && row.sector !== "Meme" && row.flows.m15.priceChangePct >= 0.1) pushSeed(row);
  }
  for (const row of otherPassed) pushSeed(row);
  const seed = rankedSeed.slice(0, 20);
  const scored = seed.map((c) => scoreCandidate(c, structureFor(c)));

  scored.sort((a, b) => b.researchScore - a.researchScore);
  const finalists = pickFinalists(scored, config.allowMemes ? 2 : 0);
  const research = finalists.map((c) => thesisFrom(c, market.regime));

  const value = {
    regime: market.regime,
    research,
    universeSize: book.length,
    eliminated,
    candidates: scored,
  };
  researchCache[chain] = { at: Date.now(), key, value };
  return value;
}

function screenKey(config: BotConfig): string {
  return [
    config.minLiquidityUsd,
    config.minVolume24hUsd,
    config.minAgeHours,
    config.allowMemes ? 1 : 0,
    venueSummary(config.venues ?? []),
    [...(config.venues ?? [])].slice().sort().join(","),
  ].join("|");
}

function collapseMints(rows: TokenCandidate[]): TokenCandidate[] {
  const best = new Map<string, TokenCandidate>();
  for (const row of rows) {
    const prev = best.get(row.mint);
    if (!prev || row.liquidityUsd > prev.liquidityUsd) best.set(row.mint, row);
  }
  return [...best.values()];
}

export function wrongAbout(regime: MarketRegime, research: ResearchThesis[]): string[] {
  return [
    "Public pool tape can be wash-traded, incentive-driven, or spoofed. Unique taker counts are not unique humans.",
    "GeckoTerminal market cap and FDV are venue-reported. They can be stale, circular, or missing — we do not fabricate replacements.",
    "No unlock calendar, treasury, or revenue dashboard is wired. Any 'cheap vs fundamentals' claim is incomplete.",
    "Short-term signals on 5m candles overfit noise. A green back-of-envelope R:R is not an edge.",
    regime.fearGreed && regime.fearGreed.value >= 70
      ? "Sentiment is already greedy. Breakouts may be late, not early."
      : "Quiet sentiment can still hide thin books — overlooked is not the same as underpriced.",
    research.some((r) => r.sector === "Meme")
      ? "Meme finalists can print research scores from activity alone. Activity is not value accrual."
      : "Excluding memes does not make remaining tokens 'fundamentals'. Many Solana venues do not route value to the token.",
    "Paper fills assume mid-price plus a small slip. Live Solana priority fees, MEV, and impact would be worse.",
    "SOL beta can invert in a session. The desk can be right on a pool and still lose if the L1 dumps.",
  ];
}
