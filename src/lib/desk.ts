import { invalidateMarketCache } from "@/lib/market/providers";
import { WATCHLIST } from "@/lib/market/universe";
import { clearResearchCache, runResearch, wrongAbout } from "@/lib/research/engine";
import { loadState, mutateState } from "@/lib/store";
import { learningReport, studyTape } from "@/lib/trading/learn";
import { bookStats } from "@/lib/trading/stats";
import type { AppState, DeskPayload, MarketRegime, TapeCard, TokenCandidate } from "@/lib/types";

function loadingRegime(): MarketRegime {
  const flat = { price: 0, change24h: 0, marketCap: 0, volume24h: 0 };
  return {
    asOf: new Date().toISOString(),
    btc: flat,
    eth: { ...flat },
    sol: { ...flat },
    btcDominance: null,
    ethDominance: null,
    totalMarketCap: null,
    marketCapChange24h: null,
    fearGreed: null,
    solanaTvl: null,
    solanaDexVolume24h: null,
    solanaDexVolumeChange1d: null,
    stance: "mixed",
    stanceWhy: "Live tape is still loading.",
    crowded: [],
    overlooked: [],
    overview: "This wallet's book is ready. Live pools are still loading.",
    narratives: [],
    yields: [],
  };
}

/** One 5-minute tape per watchlist mint, deepest pool first. Capped so the desk does not burst GeckoTerminal. */
export function watchlistTapes(candidates: TokenCandidate[]): TapeCard[] {
  const rank = new Map(WATCHLIST.map((token, index) => [token.mint, index]));
  const best = new Map<string, TokenCandidate>();
  for (const candidate of candidates) {
    if (!candidate.watchlist || !candidate.poolAddress || !rank.has(candidate.mint)) continue;
    const prev = best.get(candidate.mint);
    if (!prev || candidate.liquidityUsd > prev.liquidityUsd) best.set(candidate.mint, candidate);
  }
  return [...best.values()]
    .sort((a, b) => (rank.get(a.mint) ?? 99) - (rank.get(b.mint) ?? 99))
    .slice(0, 12)
    .map((candidate) => ({
      symbol: candidate.symbol,
      mint: candidate.mint,
      poolAddress: candidate.poolAddress,
      change15m: candidate.flows.m15.priceChangePct,
    }));
}

/** Overview and the sidebar share this. A saved armed book must not keep offering Arm. */
export function armButton(running: boolean): { action: "start" | "stop"; label: string } {
  return running ? { action: "stop", label: "Disarm the bot" } : { action: "start", label: "Arm the bot" };
}

/** Real saved book, with research left empty until the tape returns. Does not invent prices or equity. */
export function shellDesk(state: AppState): DeskPayload {
  return {
    regime: loadingRegime(),
    research: [],
    universeSize: 0,
    eliminated: 0,
    candidatesScanned: 0,
    portfolio: state.portfolio,
    positions: state.positions,
    trades: state.trades,
    signals: state.lastSignals,
    bot: state.bot,
    config: state.config,
    equityCurve: state.equityCurve,
    whatCouldBeWrong: [],
    tapeDots: [],
    tapes: [],
    stats: bookStats(state.trades, state.portfolio, state.equityCurve),
    learning: learningReport(state.memory),
    generatedAt: new Date().toISOString(),
  };
}

export async function buildDesk(force = false): Promise<DeskPayload> {
  if (force) {
    invalidateMarketCache();
    clearResearchCache();
  }
  const state = await loadState();
  const research = await runResearch(state.config, force);
  const studied = await mutateState((current) => studyTape(current, research.candidates, research.regime.stance));
  return {
    regime: research.regime,
    research: research.research,
    universeSize: research.universeSize,
    eliminated: research.eliminated,
    candidatesScanned: research.candidates.length,
    portfolio: studied.portfolio,
    positions: studied.positions,
    trades: studied.trades,
    signals: studied.lastSignals,
    bot: studied.bot,
    config: studied.config,
    equityCurve: studied.equityCurve,
    whatCouldBeWrong: wrongAbout(research.regime, research.research),
    tapeDots: research.candidates.slice(0, 24).map((c) => ({
      mint: c.mint,
      symbol: c.symbol,
      score: c.researchScore,
      change24h: c.flows.h24.priceChangePct,
      liquidityUsd: c.liquidityUsd,
      volume24hUsd: c.volume24hUsd,
    })),
    tapes: watchlistTapes(research.candidates),
    stats: bookStats(studied.trades, studied.portfolio, studied.equityCurve),
    learning: learningReport(studied.memory),
    generatedAt: new Date().toISOString(),
  };
}
