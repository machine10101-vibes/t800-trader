import { fetchOhlcv, loadMarket } from "@/lib/market/providers";
import { runResearch } from "@/lib/research/engine";
import { screenCandidate } from "@/lib/research/scoring";
import { executeLivePlan, planLiveSwap, preflightLiveSwap, type LiveRuntime } from "@/lib/solana/live";
import { isLiveSessionArmed } from "@/lib/solana/live-session";
import type { AppState, MarketRegime, Signal } from "@/lib/types";
import { emptyState, mutateState } from "@/lib/store";
import { canOpen, dayLossBreached, exitReason, sizePosition } from "./risk";
import { closePosition, markBook, openPosition, pushEquity } from "./paper";
import { buildSignals, snapshotTechnical } from "./signals";

let liveSwapInFlight = false;

function priceMap(state: AppState, extras: { mint: string; price: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of state.positions) map.set(p.mint, p.markPrice);
  for (const e of extras) map.set(e.mint, e.price);
  return map;
}

function isLive(state: AppState): boolean {
  return state.config.executionMode === "live";
}

async function liveClose(
  next: AppState,
  pos: AppState["positions"][number],
  reason: NonNullable<ReturnType<typeof exitReason>>,
  runtime: LiveRuntime,
): Promise<AppState> {
  if (pos.execution !== "live" || pos.side === "short") {
    return closePosition(next, pos.id, pos.markPrice, reason);
  }
  const blocked = preflightLiveSwap({
    executionMode: next.config.executionMode,
    sessionArmed: isLiveSessionArmed(),
    killSwitch: next.config.killSwitch,
    send: runtime.send,
    leg: "sell",
    signalSide: "long",
    notionalUsd: pos.qty * pos.markPrice,
    tokenQty: pos.qty,
    usdc: runtime.usdc,
    sol: runtime.sol,
    maxLiveNotionalUsd: Math.max(next.config.maxLiveNotionalUsd, pos.qty * pos.markPrice),
    minSolForFees: next.config.minSolForFees,
  });
  if (blocked) {
    next.bot = { ...next.bot, lastError: `Live sell blocked (${pos.symbol}): ${blocked}` };
    return next;
  }
  const plan = await planLiveSwap({
    owner: runtime.address,
    mint: pos.mint,
    leg: "sell",
    tokenQty: pos.qty,
    slippageBps: next.config.slippageBps,
  });
  if (!runtime.send) {
    next.bot = { ...next.bot, lastError: `Dry-run live sell ${pos.symbol}: would receive ~$${plan.outUi.toFixed(2)} USDC` };
    return next;
  }
  const fill = await executeLivePlan(runtime.provider, plan, runtime.address);
  runtime.usdc += fill.outUi;
  return closePosition(next, pos.id, fill.priceUsd, reason, {
    execution: "live",
    txSignature: fill.signature,
    price: fill.priceUsd,
  });
}

async function liveOpen(
  next: AppState,
  signal: Signal,
  notional: number,
  runtime: LiveRuntime,
): Promise<AppState> {
  const blocked = preflightLiveSwap({
    executionMode: next.config.executionMode,
    sessionArmed: isLiveSessionArmed(),
    killSwitch: next.config.killSwitch,
    send: runtime.send,
    leg: "buy",
    signalSide: signal.side,
    notionalUsd: notional,
    tokenQty: 0,
    usdc: runtime.usdc,
    sol: runtime.sol,
    maxLiveNotionalUsd: next.config.maxLiveNotionalUsd,
    minSolForFees: next.config.minSolForFees,
  });
  if (blocked) {
    next.bot = { ...next.bot, lastError: `Live buy blocked (${signal.symbol}): ${blocked}` };
    return next;
  }
  const spend = Math.min(notional, runtime.usdc, next.config.maxLiveNotionalUsd);
  const plan = await planLiveSwap({
    owner: runtime.address,
    mint: signal.mint,
    leg: "buy",
    usdcAmount: spend,
    slippageBps: next.config.slippageBps,
  });
  if (!runtime.send) {
    next.bot = {
      ...next.bot,
      lastError: `Dry-run live buy ${signal.symbol}: ${plan.inUi.toFixed(2)} USDC → ${plan.outUi.toFixed(6)} tokens`,
    };
    return next;
  }
  const fill = await executeLivePlan(runtime.provider, plan, runtime.address);
  runtime.usdc = Math.max(0, runtime.usdc - fill.inUi);
  const qty = fill.outUi;
  const price = fill.priceUsd || signal.price;
  return openPosition(next, { ...signal, price }, qty, {
    execution: "live",
    txSignature: fill.signature,
    price,
  });
}

export async function tickBot(runtime?: LiveRuntime): Promise<AppState> {
  return mutateState(async (state) => {
    try {
      const market = await loadMarket();
      const byMint = new Map(market.candidates.map((c) => [c.mint, c]));
      const marks: { mint: string; price: number }[] = market.candidates.map((c) => ({
        mint: c.mint,
        price: c.priceUsd,
      }));

      let next: AppState = { ...state, bot: { ...state.bot, lastError: null } };
      if (isLive(next) && runtime) {
        next = {
          ...next,
          portfolio: { ...next.portfolio, cashUsd: runtime.usdc },
        };
      }
      next = markBook(next, priceMap(next, marks));

      for (const pos of [...next.positions]) {
        const reason = exitReason(pos);
        if (!reason) continue;
        if (isLive(next) && pos.execution === "live" && runtime) {
          if (liveSwapInFlight) continue;
          liveSwapInFlight = true;
          try {
            next = await liveClose(next, pos, reason, runtime);
          } finally {
            liveSwapInFlight = false;
          }
        } else {
          next = closePosition(next, pos.id, pos.markPrice, reason);
        }
      }
      next = markBook(next, priceMap(next, marks));

      const signals: Signal[] = [];
      if (next.bot.running && !dayLossBreached(next.portfolio, next.config) && !next.config.killSwitch) {
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
          const allowShorts = isLive(next) ? false : next.config.allowShorts;
          const found = buildSignals(token, tech, token.researchScore, allowShorts);
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
          if (isLive(next)) {
            if (!runtime) {
              next.bot = { ...next.bot, lastError: "LIVE mode needs the connected wallet runtime" };
              continue;
            }
            if (liveSwapInFlight) continue;
            liveSwapInFlight = true;
            try {
              next = await liveOpen(next, signal, sized.notional, runtime);
            } finally {
              liveSwapInFlight = false;
            }
          } else {
            next = openPosition(next, signal, sized.qty);
          }
        }
      }

      next = markBook(next, priceMap(next, marks));
      next = pushEquity(next);
      next.bot = {
        ...next.bot,
        lastTickAt: new Date().toISOString(),
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
  action: "start" | "stop" | "reset" | "kill",
): AppState {
  if (action === "reset") {
    return emptyState(state.config);
  }
  if (action === "kill") {
    return {
      ...state,
      config: { ...state.config, executionMode: "paper", killSwitch: true },
      bot: { ...state.bot, running: false, lastError: "Kill switch — LIVE disarmed, bot stopped" },
    };
  }
  if (action === "start") {
    if (state.config.killSwitch && state.config.executionMode === "live") {
      return { ...state, bot: { ...state.bot, lastError: "Kill switch is on" } };
    }
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
