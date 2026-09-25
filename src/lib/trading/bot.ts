import { cachedOhlcv, loadMarket } from "@/lib/market/providers";
import { tickHeadline, tickPass } from "@/lib/market/tape";
import { ACTIVE_BOOK, isActiveBook, watchMeta } from "@/lib/market/universe";
import { runResearch } from "@/lib/research/engine";
import { screenCandidate } from "@/lib/research/scoring";
import type { AppState, ChainExecutor, MarketRegime, Position, ScoredCandidate, Signal, TradeReason } from "@/lib/types";
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
  MIN_TRADE_USD,
  payableUsd,
  walletMarkUsd,
  rollSession,
  shouldFlattenMeme,
  shouldScratch,
  sizePosition,
  walletRiskBook,
  type WalletBudget,
} from "./risk";
import { closePosition, flattenBook, markBook, openPosition, pushEquity, scaleOut, updateStop } from "./paper";
import { entrySignals, snapshotTechnical } from "./signals";
import { PERP_MIN_COLLATERAL_USD, collateralFor, multiplierFor, orderForPosition } from "./leverage";
import { reentryBlocked } from "./close";
import { LIMIT_MIN_USD, shouldReplace, type MakerDesk } from "./quote";

/** Green 15m watchlist names outrank a high score that is still red, so a flat book can actually enter. */
function huntRank(token: ScoredCandidate): number {
  const m15 = token.flows.m15.priceChangePct;
  const green = m15 >= 0.1 ? 200 + Math.min(m15, 4) * 8 : m15;
  return green + token.researchScore * 0.15 + (token.watchlist ? 25 : 0);
}

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
  if (state.config.walletSwaps && !pos.signature) return state;
  if (!state.config.walletSwaps || pos.side !== "long") {
    return closePosition(state, pos.id, pos.markPrice, reason);
  }
  if (!executor) {
    blocked.push(`${pos.symbol}: this page cannot ask the wallet to sign the sell`);
    return state;
  }
  try {
    const fill = await executor(orderForPosition(pos, "close", state.config.venues));
    return closePosition(state, pos.id, fill.price, reason, fill.signature);
  } catch (error) {
    blocked.push(`${pos.symbol}: ${error instanceof Error ? error.message : "wallet sell failed"}`);
    return state;
  }
}

export async function tickBot(
  executor?: ChainExecutor,
  budget?: WalletBudget | null,
  maker?: MakerDesk | null,
): Promise<AppState> {
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
      if (next.bot.skipReentry && !reentryBlocked(next.bot.skipReentry, next.bot.skipReentry.mint)) {
        next = { ...next, bot: { ...next.bot, skipReentry: null } };
      }
      let closed = 0;
      const blocked: string[] = [];

      if (next.bot.running && market.regime.stance === "defensive") {
        for (const pos of [...next.positions]) {
          if (shouldFlattenMeme(pos, market.regime.stance)) {
            const before = next.positions.length;
            next = await walletExit(next, pos, "risk-off", executor, blocked);
            if (next.positions.length < before) closed += 1;
          }
        }
      }

      if (next.bot.running) for (const pos of [...next.positions]) {
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
                const fill = await executor(orderForPosition(pos, "scale", next.config.venues, fraction));
                next = scaleOut(next, pos.id, fraction, fill.signature, fill.price);
              } catch (error) {
                blocked.push(`${pos.symbol}: ${error instanceof Error ? error.message : "wallet scale-out failed"}`);
              }
            }
          } else if (!next.config.walletSwaps) {
            next = scaleOut(next, pos.id, fraction);
          }
        }
      }
      if (next.bot.running) for (const pos of [...next.positions]) {
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
      let quoteNote = "";
      let quoteOwned = false;
      if (next.bot.running && maker && next.config.walletSwaps && next.bot.resting) {
        const resting = next.bot.resting;
        try {
          const looked = await maker.lookup(resting);
          if (looked !== "open" && looked !== "gone") {
            next = openPosition(
              next,
              {
                id: resting.orderKey,
                mint: resting.mint,
                symbol: resting.symbol,
                poolAddress: resting.poolAddress,
                sector: resting.sector,
                side: "long",
                reason: resting.reason,
                confidence: resting.confidence,
                price: looked.price,
                stopPct: resting.stopPct,
                targetPct: resting.targetPct,
                thesis: resting.thesis,
                researchScore: resting.researchScore,
                createdAt: resting.placedAt,
              },
              looked.qty,
              market.regime.stance,
              looked,
            );
            next = { ...next, bot: { ...next.bot, resting: undefined } };
            opened += 1;
          } else if (looked === "gone") {
            next = { ...next, bot: { ...next.bot, resting: undefined } };
          }
        } catch (error) {
          blocked.push(`limit: ${error instanceof Error ? error.message : "could not read the resting bid"}`);
        }
      }
      const risk = walletRiskBook(next.portfolio, next.positions, next.trades, budget, next.config.walletSwaps);
      if (!dayLossBreached(risk.portfolio, next.config)) {
        const research = await runResearch(next.config);
        next = studyTape(next, research.candidates, market.regime.stance);
        const spendable = budget ? payableUsd(budget) : 0;
        const marked = budget ? walletMarkUsd(budget) : 0;
        const bookTooSmall = Boolean(budget) && next.config.walletSwaps && (marked < MIN_TRADE_USD || spendable < MIN_TICKET_USD);
        if (bookTooSmall) {
          blocked.push(
            `Trading balance is under $${MIN_TRADE_USD} — the trading key needs that much SOL or USDC before a swap is sent`,
          );
        }
        const focus = research.candidates
          .filter((c) => isActiveBook(c.mint) && !screenCandidate(c, next.config))
          .sort((a, b) => huntRank(b) - huntRank(a))
          .slice(0, 16);
        for (const mint of ACTIVE_BOOK) {
          if (focus.some((token) => token.mint === mint)) continue;
          const symbol = watchMeta(mint)?.symbol ?? "Asset";
          const live = byMint.get(mint) ?? research.candidates.find((token) => token.mint === mint);
          if (!live) {
            blocked.push(`${symbol}: pool tape has not arrived`);
            continue;
          }
          blocked.push(`${symbol}: ${screenCandidate(live, next.config) ?? "not offered on this tick"}`);
        }

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
          if (!found.length) blocked.push(tickPass(token.symbol, token.flows.m15.priceChangePct));
        }

        signals.sort((a, b) => b.confidence - a.confidence);
        const shown: Signal[] = [];
        let pauseOpens = Boolean(
          next.config.walletSwaps && next.bot.swapHoldUntil && Date.parse(next.bot.swapHoldUntil) > Date.now(),
        );
        if (pauseOpens) blocked.push("Signature was declined — the next wallet prompt waits about a minute");
        for (const signal of signals) {
          if (!next.bot.running) {
            shown.push(signal);
            continue;
          }
          const advice = advise(signal, next.memory, market.regime.stance);
          const learned: Signal = {
            ...signal,
            confidence: clamp(signal.confidence + advice.confidenceDelta, 1, 97),
            thesis: advice.note ? `${signal.thesis} Learned: ${advice.note}.` : signal.thesis,
          };
          shown.push(learned);
          if (reentryBlocked(next.bot.skipReentry, learned.mint)) {
            blocked.push(`${learned.symbol}: closed by hand — the next ticket waits a few minutes`);
            continue;
          }
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
            minCashUsd: next.config.walletSwaps ? MIN_TICKET_USD : undefined,
          });
          if (gate) {
            const why =
              gate === "Insufficient cash" && next.config.walletSwaps
                ? `need at least $${MIN_TICKET_USD} in USDC or in SOL after the fee reserve. One swap cannot spend both`
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
          const wanted = multiplierFor(next.config.multipliers, learned.confidence, learned.reason, learned.symbol, learned.mint);
          const ticket = collateralFor(sized.notional * advice.sizeMul, room, wanted);
          const leverage = ticket.leverage;
          const collateralUsd = ticket.collateralUsd;
          const qty = learned.price > 0 ? (collateralUsd * leverage) / learned.price : 0;
          if (ticket.spotFallback) {
            blocked.push(
              `${learned.symbol}: ${wanted}x needs $${PERP_MIN_COLLATERAL_USD} collateral, so this ticket stays a spot buy`,
            );
          }
          const resting = next.bot.resting;
          const quoteNotional = Math.max(collateralUsd, resting && resting.mint === learned.mint ? resting.notionalUsd : 0);
          if (
            maker &&
            next.config.walletSwaps &&
            leverage === 1 &&
            learned.side === "long" &&
            quoteNotional >= LIMIT_MIN_USD &&
            !pauseOpens &&
            !bookTooSmall
          ) {
            quoteOwned = true;
            if (resting && resting.mint === learned.mint && !shouldReplace(resting.limitPrice, learned.price)) {
              quoteNote = ` · ${learned.symbol} limit bid resting`;
              continue;
            }
            try {
              if (resting) {
                await maker.cancel(resting.orderKey);
                next = { ...next, bot: { ...next.bot, resting: undefined } };
              }
              const placed = await maker.place({
                mint: learned.mint,
                symbol: learned.symbol,
                mid: learned.price,
                notionalUsd: quoteNotional,
              });
              next = {
                ...next,
                bot: {
                  ...next.bot,
                  resting: {
                    orderKey: placed.orderKey,
                    signature: placed.signature,
                    mint: learned.mint,
                    symbol: learned.symbol,
                    poolAddress: learned.poolAddress,
                    sector: learned.sector,
                    side: "long",
                    reason: learned.reason,
                    confidence: learned.confidence,
                    researchScore: learned.researchScore,
                    stopPct: learned.stopPct,
                    targetPct: learned.targetPct,
                    thesis: learned.thesis,
                    limitPrice: placed.limitPrice,
                    notionalUsd: quoteNotional,
                    outputDecimals: placed.outputDecimals,
                    placedAt: new Date().toISOString(),
                  },
                },
              };
              quoteNote = ` · ${learned.symbol} limit bid sent`;
            } catch (error) {
              blocked.push(`${learned.symbol}: ${error instanceof Error ? error.message : "limit bid failed"}`);
            }
            continue;
          }
          if (!token) {
            blocked.push(`${learned.symbol}: missing live mark`);
          } else if (collateralUsd < MIN_TICKET_USD || qty <= 0) {
            blocked.push(`${learned.symbol}: size ${collateralUsd.toFixed(2)} too small`);
          } else if (pauseOpens) {
            continue;
          } else if (bookTooSmall) {
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
                  leverage: leverage > 1 ? leverage : undefined,
                  collateralUsd: leverage > 1 ? collateralUsd : undefined,
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
            if (next.config.walletSwaps && !stamp?.signature) {
              blocked.push(`${learned.symbol}: swap was not broadcast`);
              continue;
            }
            const before = next.positions.length;
            const fill =
              stamp?.signature
                ? stamp
                : leverage > 1
                  ? { signature: "", qty, price: learned.price, tokenDecimals: 9, leverage, collateralUsd }
                  : undefined;
            next = openPosition(next, learned, stamp?.qty ?? qty, market.regime.stance, fill);
            if (next.positions.length > before) opened += 1;
            else blocked.push(`${learned.symbol}: cash could not fill the ticket`);
          }
        }
        signals.splice(0, signals.length, ...shown);
        if (maker && next.bot.resting && !quoteOwned) {
          try {
            await maker.cancel(next.bot.resting.orderKey);
            next = { ...next, bot: { ...next.bot, resting: undefined } };
            quoteNote = " · pulled the resting bid";
          } catch (error) {
            blocked.push(`limit: ${error instanceof Error ? error.message : "could not cancel the resting bid"}`);
          }
        }
      } else if (next.bot.running && dayLossBreached(risk.portfolio, next.config)) {
        blocked.push("Daily loss cap — new risk is closed");
        if (maker && next.bot.resting) {
          try {
            await maker.cancel(next.bot.resting.orderKey);
            next = { ...next, bot: { ...next.bot, resting: undefined } };
          } catch (error) {
            blocked.push(`limit: ${error instanceof Error ? error.message : "could not cancel the resting bid"}`);
          }
        }
      }

      next = markBook(next, priceMap(next, marks));
      next = pushEquity(next);
      const fills = opened || closed ? ` · opened ${opened} · closed ${closed}` : "";
      const note = `${tickHeadline(next.bot.ticks + 1, signals, blocked, next.bot.running)}${quoteNote}${fills}`;
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
      bot: { ...flat.bot, running: false, resting: undefined, lastNote: "Book flattened by hand" },
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
    bot: { ...state.bot, running: false, resting: undefined, lastNote: "Disarmed" },
  };
}

export function regimeBias(regime: MarketRegime): string {
  return regime.stance;
}
