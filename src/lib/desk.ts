import type { ChainId } from "@/lib/chain";
import { invalidateMarketCache } from "@/lib/market/providers";
import { bookTokens, isActiveBook } from "@/lib/market/universe";
import { clearResearchCache, runResearch, wrongAbout } from "@/lib/research/engine";
import { loadState, mutateState } from "@/lib/store";
import { learningReport, studyTape } from "@/lib/trading/learn";
import { bookStats } from "@/lib/trading/stats";
import type { AppState, DeskPayload, MarketRegime, TapeCard, TokenCandidate } from "@/lib/types";
import { isLiveSessionArmed } from "@/lib/solana/live-session";

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

/** One 1-minute tape for each name on this chain's book, deepest pool first. */
export function watchlistTapes(candidates: TokenCandidate[], chain: ChainId = "solana"): TapeCard[] {
  const rank = new Map(bookTokens(chain).map((token, index) => [token.mint.toLowerCase(), index]));
  const best = new Map<string, TokenCandidate>();
  for (const candidate of candidates) {
    if (!candidate.poolAddress || !isActiveBook(candidate.mint, chain)) continue;
    const key = candidate.mint.toLowerCase();
    const prev = best.get(key);
    if (!prev || candidate.liquidityUsd > prev.liquidityUsd) best.set(key, candidate);
  }
  return [...best.values()]
    .sort((a, b) => (rank.get(a.mint.toLowerCase()) ?? 99) - (rank.get(b.mint.toLowerCase()) ?? 99))
    .map((candidate) => ({
      symbol: candidate.symbol,
      mint: candidate.mint,
      poolAddress: candidate.poolAddress,
      price: candidate.priceUsd > 0 ? candidate.priceUsd : undefined,
      change5m: candidate.flows.m5.priceChangePct,
      change15m: candidate.flows.m15.priceChangePct,
    }));
}

/** Overview and the sidebar share this. A saved armed book must not keep offering Arm. */
export function armButton(running: boolean): { action: "start" | "stop"; label: string } {
  return running ? { action: "stop", label: "Disarm the bot" } : { action: "start", label: "Arm the bot" };
}

/** LIVE Arm asks the wallet to sign. PAPER must not — that blocked every Cronos paper fill. */
export function startNeedsLiveSignature(walletSwaps: boolean): boolean {
  return Boolean(walletSwaps);
}

/** Real saved book. A later runner or resume pass can keep the last scored tape. */
export function shellDesk(
  state: AppState,
  keep?: Pick<
    DeskPayload,
    "research" | "tapes" | "tapeDots" | "regime" | "universeSize" | "eliminated" | "candidatesScanned" | "whatCouldBeWrong"
  > | null,
): DeskPayload {
  const scored = Boolean(keep?.research?.length);
  return {
    regime: scored && keep?.regime ? keep.regime : loadingRegime(),
    research: keep?.research ?? [],
    universeSize: keep?.universeSize ?? 0,
    eliminated: keep?.eliminated ?? 0,
    candidatesScanned: keep?.candidatesScanned ?? 0,
    portfolio: state.portfolio,
    positions: state.positions,
    trades: state.trades,
    signals: state.lastSignals,
    bot: state.bot,
    config: state.config,
    equityCurve: state.equityCurve,
    whatCouldBeWrong: keep?.whatCouldBeWrong ?? [],
    tapeDots: keep?.tapeDots ?? [],
    tapes: keep?.tapes ?? [],
    stats: bookStats(state.trades, state.portfolio, state.equityCurve),
    learning: learningReport(state.memory),
    generatedAt: new Date().toISOString(),
    liveSessionArmed: isLiveSessionArmed(),
  };
}

export async function buildDesk(force = false, chain: ChainId = "solana"): Promise<DeskPayload> {
  if (force) {
    invalidateMarketCache(chain);
    clearResearchCache(chain);
  }
  const state = await loadState(chain);
  const research = await runResearch(state.config, force, chain);
  const studied = await mutateState((current) => studyTape(current, research.candidates, research.regime.stance), chain);
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
    whatCouldBeWrong: wrongAbout(research.regime, research.research, chain),
    tapeDots: research.candidates.slice(0, 24).map((c) => ({
      mint: c.mint,
      symbol: c.symbol,
      score: c.researchScore,
      change24h: c.flows.h24.priceChangePct,
      liquidityUsd: c.liquidityUsd,
      volume24hUsd: c.volume24hUsd,
    })),
    tapes: watchlistTapes(research.candidates, chain),
    stats: bookStats(studied.trades, studied.portfolio, studied.equityCurve),
    learning: learningReport(studied.memory),
    generatedAt: new Date().toISOString(),
    liveSessionArmed: isLiveSessionArmed(),
  };
}
