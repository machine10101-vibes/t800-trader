import { cachedOhlcv, loadMarket } from "@/lib/market/providers";
import { runResearch } from "@/lib/research/engine";
import { screenCandidate } from "@/lib/research/scoring";
import type { AppState, ChainExecutor, MarketRegime, Position, Signal, TradeReason } from "@/lib/types";
import { clamp } from "@/lib/utils";
import { emptyState, mutateState } from "@/lib/store";
import { advise, studyTape } from "./learn";
import {
  canOpen,
  cashConcentration,
  consecutiveLosses,
  dayLossBreached,
  dayLossUsedPct,
  managePosition,
  MIN_TICKET_USD,
  rollSession,
  shouldFlattenMeme,
  shouldScratch,
  sizePosition,
  walletRiskBook,
  type WalletBudget,
} from "./risk";
import { closePosition, flattenBook, markBook, openPosition, pushEquity, scaleOut, updateStop } from "./paper";
import { entrySignals, snapshotTechnical } from "./signals";

function priceMap(state: AppState, extras: { mint: string; price: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of state.positions) map.set(p.mint, p.markPrice);
  for (const e of extras) map.set(e.mint, e.price);
  return map;
}

async function walletExit(
  state: AppState,
  pos: Position,
  reason: TradeReason,
  executor: ChainExecutor | undefined,
  blocked: string[],
): Promise<AppState> {
  if (!state.config.walletSwaps || !pos.signature || pos.side !== "long") {
    return closePosition(state, pos.id, pos.markPrice, reason);
  }
  if (!executor) {
    blocked.push(`${pos.symbol}: this page cannot ask the wallet to sign the sell`);
    return state;
  }
  try {
    const fill = await executor({
      kind: "close",
      side: pos.side,
      mint: pos.mint,
      symbol: pos.symbol,
      notionalUsd: pos.qty * pos.markPrice,
      qty: pos.qty,
      price: pos.markPrice,
      tokenDecimals: pos.tokenDecimals,
      venues: state.config.venues,
    });
    return closePosition(state, pos.id, fill.price, reason, fill.signature);
  } catch (error) {
    blocked.push(`${pos.symbol}: ${error instanceof Error ? error.message : "wallet sell failed"}`);
    return state;
  }
}

export async function tickBot(executor?: ChainExecutor, budget?: WalletBudget | null): Promise<AppState> {
  return mutateState(async (state) => {
    try {
      const market = await loadMarket();
      const byMint = new Map(market.candidates.map((c) => [c.mint, c]));
      const marks: { mint: string; price: number }[] = market.candidates.map((c) => ({
        mint: c.mint,
        price: c.priceUsd,
      }));

      let next = markBook(state, priceMap(state, marks));
      next = { ...next, portfolio: rollSession(next.portfolio) };
      let closed = 0;
      const blocked: string[] = [];

      if (market.regime.stance === "defensive") {
        for (const pos of [...next.positions]) {
          if (shouldFlattenMeme(pos, market.regime.stance)) {
            const before = next.positions.length;
            next = await walletExit(next, pos, "risk-off", executor, blocked);
            if (next.positions.length < before) closed += 1;
          }
        }
      }

      for (const pos of [...next.positions]) {
        const plan = managePosition(pos, Date.now(), next.config);
        if (plan.exit) {
          const before = next.positions.length;
          next = await walletExit(next, pos, plan.exit, executor, blocked);
          if (next.positions.length < before) closed += 1;
          continue;
        }
        if (plan.nextStop) next = updateStop(next, pos.id, plan.nextStop);
        if (plan.scale) {
          const fraction = Math.min(0.75, Math.max(0.25, (next.config.scaleFractionPct ?? 50) / 100));
          if (next.config.walletSwaps && pos.signature && pos.side === "long") {
            if (!executor) {
              blocked.push(`${pos.symbol}: this page cannot ask the wallet to sign the scale-out`);
            } else {
              try {
                const fill = await executor({
                  kind: "scale",
                  side: pos.side,
                  mint: pos.mint,
                  symbol: pos.symbol,
                  notionalUsd: pos.qty * fraction * pos.markPrice,
                  qty: pos.qty * fraction,
                  price: pos.markPrice,
                  tokenDecimals: pos.tokenDecimals,
                  venues: next.config.venues,
                });
                next = scaleOut(next, pos.id, fraction, fill.signature, fill.price);
              } catch (error) {
                blocked.push(`${pos.symbol}: ${error instanceof Error ? error.message : "wallet scale-out failed"}`);
              }
            }
          } else {
            next = scaleOut(next, pos.id, fraction);
          }
        }
      }
      for (const pos of [...next.positions]) {
        const live = byMint.get(pos.mint);
        if (next.config.scratchEnabled === false) continue;
        if (!live || !shouldScratch(pos, live.flows.m5.priceChangePct, live.flows.m15.priceChangePct)) continue;
        const before = next.positions.length;
        next = await walletExit(next, pos, "time", executor, blocked);
        if (next.positions.length < before) closed += 1;
      }
      next = markBook(next, priceMap(next, marks));

      const signals: Signal[] = [];
      let opened = 0;
      const risk = walletRiskBook(next.portfolio, next.positions, next.trades, budget, next.config.walletSwaps);
      if (next.bot.running && !dayLossBreached(risk.portfolio, next.config)) {
        const research = await runResearch(next.config);
        next = studyTape(next, research.candidates, market.regime.stance);
        const focus = research.candidates
          .filter((c) => !screenCandidate(c, next.config))
          .sort((a, b) => b.researchScore - a.researchScore)
          .slice(0, 10);

        const tapeCtx = {
          stance: market.regime.stance,
          fearGreed: market.regime.fearGreed?.value ?? null,
          solChange: market.regime.sol.change24h,
        };
        for (const token of focus) {
          if (token.priceAgreement === "split") {
            blocked.push(`${token.symbol}: price feeds disagree`);
            continue;
          }
          const candles = cachedOhlcv(token.poolAddress);
          const found = entrySignals(
            token,
            candles && candles.length >= 20 ? snapshotTechnical(candles) : null,
            token.researchScore,
            next.config.allowShorts,
            tapeCtx,
          );
          signals.push(...found);
        }

        signals.sort((a, b) => b.confidence - a.confidence);
        const shown: Signal[] = [];
        let pauseOpens = Boolean(
          next.config.walletSwaps && next.bot.swapHoldUntil && Date.parse(next.bot.swapHoldUntil) > Date.now(),
        );
        if (pauseOpens) blocked.push("Signature was declined — the next wallet prompt waits about a minute");
        for (const signal of signals) {
          const advice = advise(signal, next.memory, market.regime.stance);
          const learned: Signal = {
            ...signal,
            confidence: clamp(signal.confidence + advice.confidenceDelta, 1, 97),
            thesis: advice.note ? `${signal.thesis} Learned: ${advice.note}.` : signal.thesis,
          };
          shown.push(learned);
          if (opened && next.config.oneTicketPerTick !== false) {
            blocked.push(`${learned.symbol}: passed over — one new ticket per tick`);
            continue;
          }
          if (advice.block) {
            blocked.push(advice.block);
            continue;
          }
          const gate = canOpen({
            positions: risk.positions,
            signal: learned,
            config: next.config,
            portfolio: risk.portfolio,
            trades: risk.trades,
            stance: market.regime.stance,
          });
          if (gate) {
            const why =
              gate === "Insufficient cash" && next.config.walletSwaps
                ? "need at least $5 in USDC or in SOL. One swap cannot spend both"
                : gate;
            blocked.push(`${learned.symbol} ${learned.side}: ${why}`);
            continue;
          }
          const token = byMint.get(learned.mint);
          const streak = consecutiveLosses(risk.trades);
          const sized = token
            ? sizePosition({
                equity: risk.portfolio.equityUsd,
                price: learned.price,
                stopPct: learned.stopPct,
                config: next.config,
                regime: market.regime,
                researchScore: learned.researchScore,
                confidence: learned.confidence,
                lossStreak: streak,
                dayUsed: dayLossUsedPct(risk.portfolio, next.config),
              })
            : { qty: 0, notional: 0 };
          const cashCap = cashConcentration(risk.portfolio.equityUsd, next.config);
          const room = risk.portfolio.cashUsd * Math.min(0.98, cashCap);
          const qty = learned.price > 0 ? Math.min(sized.qty * advice.sizeMul, room / learned.price) : 0;
          if (!token) {
            blocked.push(`${learned.symbol}: missing live mark`);
          } else if (sized.notional < MIN_TICKET_USD || sized.qty <= 0) {
            blocked.push(`${learned.symbol}: size ${sized.notional.toFixed(2)} too small`);
          } else if (qty * learned.price < MIN_TICKET_USD) {
            blocked.push(`${learned.symbol}: would concentrate more than ${(cashCap * 100).toFixed(0)}% cash`);
          } else if (pauseOpens) {
            continue;
          } else if (next.config.walletSwaps && learned.side === "short") {
            blocked.push(`${learned.symbol}: shorts are not sent to the wallet`);
          } else if (next.config.walletSwaps && !executor) {
            blocked.push(`${learned.symbol}: this page cannot ask the wallet to sign`);
          } else {
            let stamp: Awaited<ReturnType<ChainExecutor>> | undefined;
            if (next.config.walletSwaps && executor) {
              try {
                stamp = await executor({
                  kind: "open",
                  side: learned.side,
                  mint: learned.mint,
                  symbol: learned.symbol,
                  notionalUsd: qty * learned.price,
                  qty,
                  price: learned.price,
                  venues: next.config.venues,
                });
              } catch (error) {
                const message = error instanceof Error ? error.message : "wallet swap failed";
                blocked.push(`${learned.symbol}: ${message}`);
                if (/reject|denied|cancel|closed|declin/i.test(message)) {
                  pauseOpens = true;
                  next = {
                    ...next,
                    bot: { ...next.bot, swapHoldUntil: new Date(Date.now() + 90_000).toISOString() },
                  };
                }
                continue;
              }
            }
            const before = next.positions.length;
            next = openPosition(next, learned, stamp?.qty ?? qty, market.regime.stance, stamp);
            if (next.positions.length > before) opened += 1;
            else blocked.push(`${learned.symbol}: cash could not fill the ticket`);
          }
        }
        signals.splice(0, signals.length, ...shown);
      } else if (next.bot.running && dayLossBreached(risk.portfolio, next.config)) {
        blocked.push("Daily loss cap — new risk is closed");
      }

      next = markBook(next, priceMap(next, marks));
      next = pushEquity(next);
      const mode = next.config.walletSwaps ? " · wallet swaps" : " · simulated";
      const held = opened === 0 && blocked[0] ? ` · ${blocked[0]}` : "";
      const note = next.bot.running
        ? `Tick ${next.bot.ticks + 1} · ${signals.length} signal${signals.length === 1 ? "" : "s"} · opened ${opened} · closed ${closed} · ${market.regime.stance}${mode}${held}`
        : `Standby · closed ${closed} · ${market.regime.stance}${mode}${held}`;
      const hold =
        next.bot.swapHoldUntil && Date.parse(next.bot.swapHoldUntil) > Date.now() ? next.bot.swapHoldUntil : null;
      next.bot = {
        ...next.bot,
        lastTickAt: new Date().toISOString(),
        lastError: null,
        ticks: next.bot.ticks + 1,
        lastNote: note,
        lastOpened: opened,
        lastClosed: closed,
        blocked: blocked.slice(0, 8),
        swapHoldUntil: hold,
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
    const flat = pushEquity(flattenBook(state, "manual"));
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
        lastNote: state.config.walletSwaps
          ? "Armed — waiting on the wallet signature"
          : "Armed — first tick incoming",
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
