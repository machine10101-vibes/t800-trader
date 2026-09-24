import { invalidateMarketCache } from "@/lib/market/providers";
import { clearResearchCache, runResearch, wrongAbout } from "@/lib/research/engine";
import { loadState, mutateState } from "@/lib/store";
import { learningReport, studyTape } from "@/lib/trading/learn";
import { bookStats } from "@/lib/trading/stats";
import type { DeskPayload } from "@/lib/types";

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
    stats: bookStats(studied.trades, studied.portfolio, studied.equityCurve),
    learning: learningReport(studied.memory),
    generatedAt: new Date().toISOString(),
  };
}
