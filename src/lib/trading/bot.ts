import { fetchOhlcv, loadMarket } from "@/lib/market/providers";
import { runResearch } from "@/lib/research/engine";
import { screenCandidate } from "@/lib/research/scoring";
import type { AppState, MarketRegime, Signal } from "@/lib/types";
import { emptyState, mutateState } from "@/lib/store";
import { canOpen, dayLossBreached, exitReason, shouldFlattenMeme, sizePosition } from "./risk";
import { closePosition, flattenBook, markBook, openPosition, pushEquity } from "./paper";
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
      let closed = 0;
      const blocked: string[] = [];

      if (market.regime.stance === "defensive") {
        for (const pos of [...next.positions]) {
          if (shouldFlattenMeme(pos, market.regime.stance)) {
            next = closePosition(next, pos.id, pos.markPrice, "risk-off");
            closed += 1;
          }
        }
      }

      for (const pos of [...next.positions]) {
        const reason = exitReason(pos);
        if (reason) {
          next = closePosition(next, pos.id, pos.markPrice, reason);
          closed += 1;
        }
      }
      next = markBook(next, priceMap(next, marks));

      const signals: Signal[] = [];
      let opened = 0;
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
          const found = buildSignals(token, tech, token.researchScore, next.config.allowShorts, market.regime.stance);
          signals.push(...found);
        }

        signals.sort((a, b) => b.confidence - a.confidence);
        for (const signal of signals) {
          const gate = canOpen({
            positions: next.positions,
            signal,
            config: next.config,
            portfolio: next.portfolio,
            trades: next.trades,
            stance: market.regime.stance,
          });
          if (gate) {
            blocked.push(`${signal.symbol} ${signal.side}: ${gate}`);
            continue;
          }
          if (signal.confidence < 58) {
            blocked.push(`${signal.symbol}: confidence ${signal.confidence.toFixed(0)} below 58`);
            continue;
          }
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
          if (sized.notional < 20 || sized.qty <= 0) {
            blocked.push(`${signal.symbol}: size ${sized.notional.toFixed(0)} too small`);
            continue;
          }
          if (sized.notional > next.portfolio.cashUsd * 0.95) {
            blocked.push(`${signal.symbol}: not enough cash`);
            continue;
          }
          next = openPosition(next, signal, sized.qty);
          opened += 1;
        }
      } else if (next.bot.running && dayLossBreached(next.portfolio, next.config)) {
        blocked.push("Daily loss cap — new risk is closed");
      }

      next = markBook(next, priceMap(next, marks));
      next = pushEquity(next);
      const note = next.bot.running
        ? `Tick ${next.bot.ticks + 1} · ${signals.length} signal${signals.length === 1 ? "" : "s"} · opened ${opened} · closed ${closed} · ${market.regime.stance}`
        : `Standby · closed ${closed} · ${market.regime.stance}`;
      next.bot = {
        ...next.bot,
        lastTickAt: new Date().toISOString(),
        lastError: null,
        ticks: next.bot.ticks + 1,
        lastNote: note,
        lastOpened: opened,
        lastClosed: closed,
        blocked: blocked.slice(0, 8),
      };
      next.lastSignals = signals.slice(0, 12);
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tick failed";
      return {
        ...state,
        bot: {
          ...state.bot,
          lastError: message,
          lastTickAt: new Date().toISOString(),
          lastNote: message,
          lastOpened: state.bot.lastOpened ?? 0,
          lastClosed: state.bot.lastClosed ?? 0,
          blocked: state.bot.blocked ?? [],
        },
      };
    }
  });
}

export function applyControl(state: AppState, action: "start" | "stop" | "reset" | "flatten"): AppState {
  if (action === "reset") {
    return emptyState(state.config);
  }
  if (action === "flatten") {
    const flat = flattenBook(state, "manual");
    return {
      ...flat,
      bot: { ...flat.bot, running: false, lastNote: "Book flattened by hand" },
    };
  }
  if (action === "start") {
    return {
      ...state,
      bot: {
        ...state.bot,
        running: true,
        startedAt: state.bot.startedAt ?? new Date().toISOString(),
        lastError: null,
        lastNote: "Armed — first tick incoming",
        lastOpened: state.bot.lastOpened ?? 0,
        lastClosed: state.bot.lastClosed ?? 0,
        blocked: state.bot.blocked ?? [],
      },
    };
  }
  return {
    ...state,
    bot: { ...state.bot, running: false, lastNote: "Disarmed" },
  };
}

export function regimeBias(regime: MarketRegime): string {
  return regime.stance;
}
