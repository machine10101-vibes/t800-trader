import { invalidateMarketCache } from "@/lib/market/providers";
import { clearResearchCache, runResearch, wrongAbout } from "@/lib/research/engine";
import { loadState } from "@/lib/store";
import type { DeskPayload } from "@/lib/types";

export async function buildDesk(force = false): Promise<DeskPayload> {
  if (force) {
    invalidateMarketCache();
    clearResearchCache();
  }
  const state = await loadState();
  const research = await runResearch(state.config, force);
  return {
    regime: research.regime,
    research: research.research,
    universeSize: research.universeSize,
    eliminated: research.eliminated,
    candidatesScanned: research.candidates.length,
    portfolio: state.portfolio,
    positions: state.positions,
    trades: state.trades,
    signals: state.lastSignals,
    bot: state.bot,
    config: state.config,
    equityCurve: state.equityCurve,
    whatCouldBeWrong: wrongAbout(research.regime, research.research),
    tapeDots: research.candidates.slice(0, 24).map((c) => ({
      mint: c.mint,
      symbol: c.symbol,
      score: c.researchScore,
      change24h: c.flows.h24.priceChangePct,
      liquidityUsd: c.liquidityUsd,
      volume24hUsd: c.volume24hUsd,
    })),
    generatedAt: new Date().toISOString(),
  };
}
