import { sameMint, type ChainId } from "@/lib/chain";
import { cachedOhlcv, cachedTapeMarks, livePoolPrice, loadFrameCharts, loadMarket } from "@/lib/market/providers";
import { candleChangePct, cashExit, printClose, solanaKeepEntry, solanaPass, tickHeadline } from "@/lib/market/tape";
import { bookMints, headlineFor, isActiveBook, SOL_MINT, watchMeta, WCRO_MINT } from "@/lib/market/universe";
import { runResearch } from "@/lib/research/engine";
import { bookScreen, screenCandidate } from "@/lib/research/scoring";
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
  favorableMovePct,
  managePosition,
  MIN_TICKET_USD,
  MIN_TRADE_USD,
  marginCashUsd,
  payableUsd,
  walletMarkUsd,
  presetBracket,
  profitClearsFees,
  rollSession,
  shouldFlattenMeme,
  shouldScratch,
  sizePosition,
  walletRiskBook,
  withUserBracket,
  type WalletBudget,
} from "./risk";
import { closePosition, findQuote, flattenBook, markBook, marksForOpen, openPosition, pushEquity, scaleOut, updateStop } from "./paper";
import { deskEntrySignals } from "./mtf";
import { PERP_MIN_COLLATERAL_USD, leveragedTicket, orderForPosition, signedOnChain, tradeLeverage } from "./leverage";
import { bracketQuiet, bracketQuietUntil, isAlreadyFlat, reentryBlocked, reentryHold, reentryNote } from "./close";
import type { MakerDesk } from "./quote";
import { isLiveSessionArmed } from "@/lib/solana/live-session";

/** Green 15m watchlist names outrank a high score that is still red, so a flat book can actually enter. */
export function huntRank(token: ScoredCandidate): number {
  const m15 = token.flows.m15.priceChangePct;
  const green = m15 >= 0.1 ? 200 + Math.min(m15, 4) * 8 : m15;
  return green + token.researchScore * 0.15 + (token.watchlist ? 25 : 0);
}

async function marksForPositions(
  positions: Position[],
  candidates: { mint: string; priceUsd: number }[],
  chain: ChainId,
): Promise<Map<string, number>> {
  const quotes = candidates.map((row) => ({ mint: row.mint, price: row.priceUsd }));
  for (const pos of positions) {
    if (findQuote(pos.mint, quotes)) continue;
    const price = await livePoolPrice(pos.poolAddress, chain);
    if (price && price > 0) quotes.push({ mint: pos.mint, price });
  }
  const prints = positions.map((pos) => ({
    pool: pos.poolAddress,
    price: printClose(cachedOhlcv(pos.poolAddress), cachedTapeMarks(pos.poolAddress)) ?? 0,
  }));
  return marksForOpen(positions, quotes, prints);
}

async function walletExit(
  state: AppState,
  pos: Position,
  reason: TradeReason,
  executor: ChainExecutor | undefined,
  blocked: string[],
): Promise<AppState> {
  if (signedOnChain(pos)) {
    if (!executor) {
      blocked.push(`${pos.symbol}: this page cannot ask the wallet to sign the sell`);
      return state;
    }
    try {
      const fill = await executor(orderForPosition(pos, "close", state.config.venues));
      return closePosition(state, pos.id, fill.price, reason, fill.signature);
    } catch (error) {
      const message = error instanceof Error ? error.message : "wallet sell failed";
      if (isAlreadyFlat(message)) return closePosition(state, pos.id, pos.markPrice, reason);
      blocked.push(`${pos.symbol}: ${message}`);
      return state;
    }
  }
  if (state.config.walletSwaps && !pos.signature) {
    if (pos.side === "short") return closePosition(state, pos.id, pos.markPrice, reason);
    return state;
  }
  return closePosition(state, pos.id, pos.markPrice, reason);
}

export async function tickBot(
  executor?: ChainExecutor,
  budget?: WalletBudget | null,
  maker?: MakerDesk | null,
  chain: ChainId = "solana",
): Promise<AppState> {
  // Read the tape before taking the book lock. Arm has to be able to flip
  // the bot on while a tick is still waiting on Jupiter and Gecko.
  let market: Awaited<ReturnType<typeof loadMarket>>;
  try {
    market = await loadMarket(false, chain);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tick failed";
    return mutateState((state) => ({
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
    }), chain);
  }
  return mutateState(async (state) => {
    let next = state;
    try {
      const byMint = new Map(market.candidates.map((c) => [c.mint, c]));
      const prices = await marksForPositions(state.positions, market.candidates, chain);

      next = markBook(state, prices);
      next = {
        ...next,
        positions: next.positions.map((pos) => presetBracket(pos, next.config)),
      };
      next = { ...next, portfolio: rollSession(next.portfolio) };
      if (next.bot.skipReentry && !reentryBlocked(next.bot.skipReentry, next.bot.skipReentry.mint)) {
        next = { ...next, bot: { ...next.bot, skipReentry: null } };
      }
      if (next.bot.bracketQuietUntil && !bracketQuiet(next.bot.bracketQuietUntil)) {
        next = { ...next, bot: { ...next.bot, bracketQuietUntil: null } };
      }
      let closed = 0;
      let presetFilled = false;
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
        if (plan.feeHold) blocked.push(`${pos.symbol}: the gain does not beat the fee to open and the fee to close yet`);
        if (plan.exit) {
          const before = next.positions.length;
          next = await walletExit(next, pos, plan.exit, executor, blocked);
          if (next.positions.length < before) {
            closed += 1;
            if (plan.exit === "stop" || plan.exit === "target") {
              presetFilled = true;
              next = {
                ...next,
                bot: {
                  ...next.bot,
                  skipReentry: reentryHold(pos.mint, Date.now(), plan.exit),
                  bracketQuietUntil: bracketQuietUntil(),
                },
              };
            }
          }
          continue;
        }
        if (plan.nextStop) next = updateStop(next, pos.id, plan.nextStop);
        if (plan.scale) {
          const saved = (next.config.scaleFractionPct ?? 50) / 100;
          const bank = (pos.leverage ?? 1) >= 5 ? Math.max(saved, 0.6) : saved;
          const fraction = Math.min(0.75, Math.max(0.25, bank));
          const onChainScale = signedOnChain(pos);
          if (next.config.walletSwaps && onChainScale) {
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
          } else if (!next.config.walletSwaps || (pos.side === "short" && !pos.signature)) {
            next = scaleOut(next, pos.id, fraction);
          }
        }
      }
      if (next.bot.running) for (const pos of [...next.positions]) {
        const live = byMint.get(pos.mint) ?? [...byMint.values()].find((row) => sameMint(row.mint, pos.mint));
        const candles = cachedOhlcv(pos.poolAddress);
        const m15 = live ? live.flows.m15.priceChangePct : candleChangePct(candles ?? [], 15);
        const m5 = live ? live.flows.m5.priceChangePct : candleChangePct(candles ?? [], 5);
        if (next.config.scratchEnabled === false) continue;
        const cashTape = m15 !== null && cashExit(pos.side, m15);
        const scratch = m5 !== null && m15 !== null && shouldScratch(pos, m5, m15);
        if (favorableMovePct(pos) > 0 && !profitClearsFees(pos) && (cashTape || scratch)) {
          blocked.push(`${pos.symbol}: the gain does not beat the fee to open and the fee to close yet`);
          continue;
        }
        if (cashTape) {
          const before = next.positions.length;
          next = await walletExit(next, pos, "fade", executor, blocked);
          if (next.positions.length < before) closed += 1;
          continue;
        }
        if (!scratch) continue;
        const before = next.positions.length;
        next = await walletExit(next, pos, "time", executor, blocked);
        if (next.positions.length < before) closed += 1;
      }
      next = markBook(next, prices);

      const signals: Signal[] = [];
      let opened = 0;
      let quoteNote = "";
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
                stopPct: next.config.stopLossPct,
                targetPct: next.config.targetProfitPct,
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
      const nativeMint = chain === "cronos" ? WCRO_MINT : SOL_MINT;
      const nativeMark = [...prices.entries()].find(([mint, price]) => price > 0 && sameMint(mint, nativeMint))?.[1] ?? 0;
      const priced =
        budget && !(budget.solPriceUsd > 0) && nativeMark > 0 ? { ...budget, solPriceUsd: nativeMark } : budget;
      const risk = walletRiskBook(next.portfolio, next.positions, next.trades, priced, next.config.walletSwaps);
      const balanceUnread = Boolean(next.config.walletSwaps && next.bot.running && !budget);
      if (balanceUnread) blocked.push("Could not read the trading balance, so no new ticket was sent");
      if (!dayLossBreached(risk.portfolio, next.config)) {
        const research = await runResearch(next.config, false, chain);
        next = studyTape(next, research.candidates, market.regime.stance);
        const spendable = priced ? payableUsd(priced) : 0;
        const marked = priced ? walletMarkUsd(priced) : 0;
        const bookTooSmall = Boolean(priced) && next.config.walletSwaps && (marked < MIN_TRADE_USD || spendable < MIN_TICKET_USD);
        if (bookTooSmall) {
          blocked.push(
            `Trading balance is under $${MIN_TRADE_USD} — the trading key needs that much ${chain === "cronos" ? "CRO" : "SOL"} or USDC before a swap is sent`,
          );
        }
        const screen = bookScreen(next.config, chain);
        const focus = research.candidates
          .filter((c) => isActiveBook(c.mint, chain) && !screenCandidate(c, screen))
          .sort((a, b) => huntRank(b) - huntRank(a))
          .slice(0, 16);
        for (const mint of bookMints(chain)) {
          if (focus.some((token) => token.mint === mint || token.mint.toLowerCase() === mint.toLowerCase())) continue;
          const symbol = watchMeta(mint, chain)?.symbol ?? "Asset";
          const live = byMint.get(mint) ?? research.candidates.find((token) => sameMint(token.mint, mint));
          if (!live) {
            blocked.push(`${symbol}: pool tape has not arrived`);
            continue;
          }
          blocked.push(`${symbol}: ${screenCandidate(live, screen) ?? "not offered on this tick"}`);
        }

        const tapeCtx = {
          stance: market.regime.stance,
          fearGreed: market.regime.fearGreed?.value ?? null,
          solChange: market.regime.sol.change24h,
        };
        const charts = await Promise.all(focus.map((token) => loadFrameCharts(token.mint, chain)));
        focus.forEach((token, i) => {
          if (token.priceAgreement === "split") {
            blocked.push(`${token.symbol}: price feeds disagree`);
            return;
          }
          const frames = charts[i];
          const mode = chain === "cronos" ? "spot" : next.config.solTradeMode;
          const decision = deskEntrySignals(
            token,
            { m15: frames["15m"], h1: frames["1h"], h4: frames["4h"] },
            token.researchScore,
            next.config.allowShorts,
            tapeCtx,
            { mode, marginOnFourHour: chain === "solana" && next.config.marginOnFourHour },
          );
          if (decision.missing) {
            blocked.push(`${token.symbol}: ${decision.missing} chart has not loaded`);
            return;
          }
          const found = decision.signals.filter((signal) =>
            signal.setupFrame === "4h" ? true : solanaKeepEntry(signal.side, token.flows.m15.priceChangePct),
          );
          signals.push(...found);
          if (!found.length) {
            blocked.push(decision.pass ?? solanaPass(token.symbol, token.flows.m15.priceChangePct));
          }
        });

        signals.sort((a, b) => b.confidence - a.confidence);
        const shown: Signal[] = [];
        let pauseOpens = Boolean(
          next.config.walletSwaps && next.bot.swapHoldUntil && Date.parse(next.bot.swapHoldUntil) > Date.now(),
        );
        if (pauseOpens) blocked.push("Signature was declined — the next wallet prompt waits about a minute");
        if (next.config.killSwitch) {
          pauseOpens = true;
          blocked.push("Kill switch is on");
        }
        if (chain === "solana" && next.config.walletSwaps && !isLiveSessionArmed()) {
          pauseOpens = true;
          blocked.push("Re-confirm LIVE this session before sending swaps");
        }
        if (maker && next.bot.resting) {
          try {
            await maker.cancel(next.bot.resting.orderKey);
            next = { ...next, bot: { ...next.bot, resting: undefined } };
            quoteNote = " · pulled the resting bid";
          } catch (error) {
            blocked.push(`limit: ${error instanceof Error ? error.message : "could not cancel the resting bid"}`);
          }
        }
        for (const signal of signals) {
          if (!next.bot.running) {
            shown.push(signal);
            continue;
          }
          const advice = advise(signal, next.memory, market.regime.stance);
          const learned: Signal = withUserBracket(
            {
              ...signal,
              confidence: clamp(signal.confidence + advice.confidenceDelta, 1, 97),
              thesis: advice.note ? `${signal.thesis} Learned: ${advice.note}.` : signal.thesis,
            },
            next.config,
          );
          shown.push(learned);
          if (balanceUnread) continue;
          if (reentryBlocked(next.bot.skipReentry, learned.mint)) {
            blocked.push(reentryNote(learned.symbol, next.bot.skipReentry?.why));
            continue;
          }
          if (presetFilled || bracketQuiet(next.bot.bracketQuietUntil)) {
            blocked.push(`${learned.symbol}: stop and target were preset — no new trade after that fill`);
            continue;
          }
          if (opened >= 2 && next.config.oneTicketPerTick !== false) {
            blocked.push(`${learned.symbol}: passed over — two new tickets this scan`);
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
            defensiveShorts: true,
          });
          if (gate) {
            const native = chain === "cronos" ? "CRO" : "SOL";
            const why =
              gate === "Insufficient cash" && next.config.walletSwaps
                ? `need at least $${MIN_TICKET_USD} in USDC or in ${native} after the fee reserve. One swap cannot spend both`
                : gate;
            blocked.push(`${learned.symbol} ${learned.side}: ${why}`);
            continue;
          }
          const token = byMint.get(learned.mint) ?? [...byMint.values()].find((row) => sameMint(row.mint, learned.mint));
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
          const mode = chain === "cronos" ? "spot" : next.config.solTradeMode;
          const wanted = tradeLeverage({
            multipliers: next.config.multipliers,
            confidence: Math.max(signal.confidence, learned.confidence),
            reason: learned.reason,
            symbol: learned.symbol,
            mint: learned.mint,
            mode,
            marginOnFourHour: next.config.marginOnFourHour,
            setupFrame: learned.setupFrame,
          });
          const solPerp = chain === "solana" && (learned.symbol === "SOL" || sameMint(learned.mint, SOL_MINT));
          const liveShort = Boolean(next.config.walletSwaps && learned.side === "short");
          if (next.positions.some((pos) => sameMint(pos.mint, learned.mint))) {
            blocked.push(`${learned.symbol}: already in this mint`);
            continue;
          }
          if (liveShort && mode === "spot") {
            blocked.push(`${learned.symbol}: spot mode only sends Jupiter swaps, so a live short waits`);
            continue;
          }
          if (liveShort && next.config.marginOnFourHour && learned.setupFrame !== "4h") {
            blocked.push(`${learned.symbol}: margin waits for a solid 4-hour setup, so this 15-minute short stays off live`);
            continue;
          }
          const wantedLev = liveShort && solPerp && wanted <= 1 ? 5 : wanted;
          const paying = wantedLev > 1 && solPerp && priced ? marginCashUsd(priced) : risk.portfolio.cashUsd;
          const ticket = leveragedTicket(sized.notional * advice.sizeMul, paying, cashCap, wantedLev);
          let leverage = ticket.leverage;
          let collateralUsd = ticket.collateralUsd;
          if (next.config.walletSwaps && collateralUsd > next.config.maxLiveNotionalUsd + 1e-9) {
            collateralUsd = next.config.maxLiveNotionalUsd;
          }
          if (leverage > 1 && !(collateralUsd + 1e-9 >= PERP_MIN_COLLATERAL_USD)) {
            leverage = 1;
          }
          const qty = learned.price > 0 ? (collateralUsd * leverage) / learned.price : 0;
          if (liveShort && solPerp && (ticket.spotFallback || leverage <= 1)) {
            blocked.push(
              `${learned.symbol}: a live short needs $${PERP_MIN_COLLATERAL_USD} of collateral for a Jupiter perp`,
            );
            continue;
          }
          if (ticket.spotFallback && learned.side !== "short") {
            blocked.push(
              `${learned.symbol}: ${wantedLev}x needs $${PERP_MIN_COLLATERAL_USD} on the trading key, so this ticket stays a spot buy`,
            );
          }
          if (!token) {
            blocked.push(`${learned.symbol}: missing live mark`);
          } else if (collateralUsd < MIN_TICKET_USD || qty <= 0) {
            blocked.push(`${learned.symbol}: size ${collateralUsd.toFixed(2)} too small`);
          } else if (pauseOpens) {
            continue;
          } else if (bookTooSmall) {
            continue;
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
        if (maker && next.bot.resting) {
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

      next = markBook(next, prices);
      next = pushEquity(next);
      const fills = opened || closed ? ` · opened ${opened} · closed ${closed}` : "";
      const stuck = !opened && !closed && blocked[0] ? ` · ${blocked[0]}` : "";
      const note = `${tickHeadline(next.bot.ticks + 1, signals, blocked, next.bot.running, headlineFor(chain))}${quoteNote}${fills}${stuck}`;
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
        ...next,
        bot: {
          ...next.bot,
          lastError: message,
          lastTickAt: new Date().toISOString(),
          lastNote: message,
          lastOpened: next.bot.lastOpened ?? 0,
          lastClosed: next.bot.lastClosed ?? 0,
          blocked: next.bot.blocked ?? [],
        },
      };
    }
  }, chain);
}

export function applyControl(state: AppState, action: "start" | "stop" | "reset" | "flatten" | "kill"): AppState {
  if (action === "reset") {
    return emptyState(state.config);
  }
  if (action === "kill") {
    return {
      ...state,
      config: { ...state.config, executionMode: "paper", walletSwaps: false, killSwitch: true },
      bot: { ...state.bot, running: false, resting: undefined, lastNote: "Kill switch — desk is paper and disarmed" },
    };
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
