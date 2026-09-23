import { fetchOhlcv, loadMarket } from "@/lib/market/providers";
import { runResearch } from "@/lib/research/engine";
import { screenCandidate } from "@/lib/research/scoring";
import type { AppState, MarketRegime, Signal } from "@/lib/types";
import { emptyState, mutateState } from "@/lib/store";
import { canOpen, dayLossBreached, exitReason, sizePosition } from "./risk";
import { closePosition, markBook, openPosition, pushEquity } from "./paper";
import { buildSignals, snapshotTechnical } from "./signals";

function priceMap(state: AppState, extras: { mint: string; price: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of state.positions) map.set(p.mint, p.markPrice);
  for (const e of extras) map.set(e.mint, e.price);
  return map;
}

export async function tickBot(): Promise<AppState> {
  return mutateState(async (state) => {
    try {
      const market = await loadMarket();
      const byMint = new Map(market.candidates.map((c) => [c.mint, c]));
      const marks: { mint: string; price: number }[] = market.candidates.map((c) => ({
        mint: c.mint,
        price: c.priceUsd,
      }));

      let next = markBook(state, priceMap(state, marks));

      for (const pos of [...next.positions]) {
        const reason = exitReason(pos);
        if (reason) {
          next = closePosition(next, pos.id, pos.markPrice, reason);
        }
      }
      next = markBook(next, priceMap(next, marks));

      const signals: Signal[] = [];
      if (next.bot.running && !dayLossBreached(next.portfolio, next.config)) {
        const research = await runResearch(next.config);
        const focus = research.candidates
          .filter((c) => !screenCandidate(c, next.config))
          .sort((a, b) => b.researchScore - a.researchScore)
          .slice(0, 10);

        for (const token of focus) {
          let tech = token.technical;
          if (tech.rsi14 === null) {
            try {
              const candles = await fetchOhlcv(token.poolAddress, 70);
              tech = snapshotTechnical(candles);
            } catch {
              continue;
            }
          }
          const found = buildSignals(token, tech, token.researchScore, next.config.allowShorts);
          signals.push(...found);
        }

        signals.sort((a, b) => b.confidence - a.confidence);
        for (const signal of signals) {
          const blocked = canOpen({
            positions: next.positions,
            signal,
            config: next.config,
            portfolio: next.portfolio,
          });
          if (blocked) continue;
          if (signal.confidence < 58) continue;
          const token = byMint.get(signal.mint);
          if (!token) continue;
          const sized = sizePosition({
            equity: next.portfolio.equityUsd,
            price: signal.price,
            stopPct: signal.stopPct,
            config: next.config,
            regime: market.regime,
            researchScore: signal.researchScore,
          });
          if (sized.notional < 20 || sized.qty <= 0) continue;
          if (sized.notional > next.portfolio.cashUsd * 0.95) continue;
          next = openPosition(next, signal, sized.qty);
        }
      }

      next = markBook(next, priceMap(next, marks));
      next = pushEquity(next);
      next.bot = {
        ...next.bot,
        lastTickAt: new Date().toISOString(),
        lastError: null,
        ticks: next.bot.ticks + 1,
      };
      next.lastSignals = signals.slice(0, 12);
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tick failed";
      return {
        ...state,
        bot: { ...state.bot, lastError: message, lastTickAt: new Date().toISOString() },
      };
    }
  });
}

export function applyControl(
  state: AppState,
  action: "start" | "stop" | "reset",
): AppState {
  if (action === "reset") {
    return emptyState(state.config);
  }
  if (action === "start") {
    return {
      ...state,
      bot: {
        ...state.bot,
        running: true,
        startedAt: state.bot.startedAt ?? new Date().toISOString(),
        lastError: null,
      },
    };
  }
  return {
    ...state,
    bot: { ...state.bot, running: false },
  };
}

export function regimeBias(regime: MarketRegime): string {
  return regime.stance;
}
