import { armButton, buildDesk, shellDesk } from "@/lib/desk";
import {
  authorizeTrading,
  reclaimTrading,
  sendTradingProfit,
  tradingBudgetAddress,
  tradingKeypair,
  tradingProfitUsd,
  tradingSnapshot,
} from "@/lib/solana/authorize";
import { makerDesk } from "@/lib/solana/limit";
import { executorFor } from "@/lib/solana/swap";
import { orderForPosition } from "@/lib/trading/leverage";
import { readBalances, type WalletSession } from "@/lib/solana/wallet";
import type { WalletBudget } from "@/lib/trading/risk";
import { adoptLiveEquity, attachWallet, detachWallet, getActiveWallet, loadState, mutateState, normalizeConfig } from "@/lib/store";
import { applyControl, tickBot } from "@/lib/trading/bot";
import { isAlreadyFlat, reentryHold } from "@/lib/trading/close";
import { closePosition, pushEquity } from "@/lib/trading/paper";
import type { BotConfig, ChainExecutor, DeskPayload } from "@/lib/types";

export { adoptLiveEquity, attachWallet, detachWallet, getActiveWallet, armButton, shellDesk, tradingProfitUsd, tradingSnapshot };

export async function loadDesk(force = false): Promise<DeskPayload> {
  return buildDesk(force);
}

async function sellSignedPositions(executor: ChainExecutor): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const state = await loadState();
    if (!state.config.walletSwaps) return;
    const pos = state.positions.find((p) => p.signature && p.side === "long");
    if (!pos) return;
    await mutateState(async (current) => {
      const still = current.positions.find((p) => p.id === pos.id);
      if (!still?.signature || still.side !== "long") return current;
      const fill = await executor(orderForPosition(still, "close", current.config.venues));
      return pushEquity(closePosition(current, still.id, fill.price, "manual", fill.signature));
    });
  }
}

async function budgetFor(session?: WalletSession | null): Promise<WalletBudget | null> {
  if (!session) return null;
  const bot = tradingKeypair(session.address);
  const address = tradingBudgetAddress(session.address);
  try {
    let live = await readBalances(address);
    if (bot && live.usdc < 1 && live.sol < 0.01) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      live = await readBalances(address);
    }
    return { usdc: live.usdc, sol: live.sol, solPriceUsd: live.solPriceUsd ?? session.solPriceUsd ?? 0 };
  } catch {
    return bot ? { usdc: 0, sol: 0, solPriceUsd: session.solPriceUsd ?? 0 } : { usdc: session.usdc, sol: session.sol, solPriceUsd: session.solPriceUsd ?? 0 };
  }
}

export async function controlBot(
  action: "start" | "stop" | "reset" | "tick" | "flatten",
  session?: WalletSession | null,
): Promise<DeskPayload> {
  const executor = session ? executorFor(session) : undefined;
  const maker = session ? makerDesk(session) : null;
  if (action === "tick") {
    const state = await loadState();
    await tickBot(executor, state.config.walletSwaps ? await budgetFor(session) : null, state.config.walletSwaps ? maker : null);
    return buildDesk();
  }
  if ((action === "stop" || action === "flatten" || action === "reset") && maker) {
    const resting = (await loadState()).bot.resting;
    if (resting) await maker.cancel(resting.orderKey).catch(() => undefined);
  }
  if ((action === "stop" || action === "flatten" || action === "reset") && executor) {
    await sellSignedPositions(executor);
  }
  let reclaimed: string | null = null;
  let principalAfter: number | null = null;
  if ((action === "stop" || action === "flatten" || action === "reset") && session) {
    const bot = tradingKeypair(session.address);
    const before = bot ? await readBalances(bot.publicKey.toBase58()).catch(() => null) : null;
    const open = (await loadState()).positions.some((p) => p.signature && p.side === "long");
    reclaimed = await reclaimTrading(session.address, open ? 0.015 : 0);
    if (bot) {
      const after = await readBalances(bot.publicKey.toBase58()).catch(() => null);
      const returned = Math.max(0, (before?.equityUsd ?? 0) - (after?.equityUsd ?? 0));
      const prior = (await loadState()).bot.swapPrincipalUsd;
      principalAfter = Math.max(0, (prior ?? before?.equityUsd ?? 0) - returned);
    } else {
      principalAfter = 0;
    }
  }

  let auth: { signature: string; botAddress: string; reused: boolean; equityUsd: number; depositedUsd: number } | null = null;
  if (action === "start" && session) {
    const state = await loadState();
    if (state.config.walletSwaps) auth = await authorizeTrading(session);
  }

  await mutateState((state) => {
    const unsold = state.config.walletSwaps && state.positions.some((p) => p.signature && p.side === "long");
    if ((action === "flatten" || action === "reset") && unsold) return state;
    const next = applyControl(state, action);
    if (reclaimed && (action === "stop" || action === "flatten")) {
      const short = `${reclaimed.slice(0, 8)}…`;
      return {
        ...next,
        bot: {
          ...next.bot,
          swapPrincipalUsd: principalAfter ?? next.bot.swapPrincipalUsd,
          lastNote: action === "stop" ? `Disarmed — returned ${short}` : `Book flattened — returned ${short}`,
        },
      };
    }
    if (action !== "start" || !auth) {
      if (principalAfter == null) return next;
      return { ...next, bot: { ...next.bot, swapPrincipalUsd: principalAfter } };
    }
    const short = auth.reused ? "trading key already funded" : `signed ${auth.signature.slice(0, 8)}…`;
    const prior = next.bot.swapPrincipalUsd;
    let swapPrincipalUsd = prior;
    if (prior == null) {
      swapPrincipalUsd = auth.reused ? auth.equityUsd : Math.max(0, auth.equityUsd - auth.depositedUsd) + auth.depositedUsd;
    } else if (!auth.reused) {
      const baselineGrabbedDeposit = auth.depositedUsd > 0 && Math.abs(prior - auth.equityUsd) < 0.5;
      swapPrincipalUsd = baselineGrabbedDeposit ? prior : prior + auth.depositedUsd;
    }
    return {
      ...next,
      bot: {
        ...next.bot,
        swapAuthSignature: auth.signature,
        swapBot: auth.botAddress,
        swapPrincipalUsd,
        lastNote: `Armed — ${short}. Swaps send from that signature.`,
      },
    };
  });
  if (action === "start") {
    const state = await loadState();
    await tickBot(executor, state.config.walletSwaps ? await budgetFor(session) : null, state.config.walletSwaps ? maker : null);
  }
  return buildDesk();
}

/** Record the current trading equity once, so an older funded key is not treated as profit. */
export async function baselineTradingPrincipal(equityUsd: number): Promise<boolean> {
  if (!(equityUsd >= 1)) return false;
  let wrote = false;
  await mutateState((state) => {
    if (state.bot.swapPrincipalUsd != null) return state;
    wrote = true;
    return { ...state, bot: { ...state.bot, swapPrincipalUsd: equityUsd } };
  });
  return wrote;
}

/** Move cash profit from the trading key back to the connected wallet. The deposit stays. */
export async function withdrawTradingProfit(session: WalletSession): Promise<DeskPayload> {
  const state = await loadState();
  const principal = state.bot.swapPrincipalUsd;
  if (principal == null) {
    const held = await readBalances(tradingBudgetAddress(session.address));
    await baselineTradingPrincipal(held.equityUsd);
    throw new Error("No trading profit to send yet. The bot keeps the balance it is still using.");
  }
  const open = state.positions.some((p) => p.signature && p.side === "long");
  const sent = await sendTradingProfit(session.address, principal, open ? 0.015 : 0.01);
  await mutateState((current) => ({
    ...current,
    bot: {
      ...current.bot,
      lastNote: `Sent $${sent.profitUsd.toFixed(2)} profit to the wallet · ${sent.signature.slice(0, 8)}…`,
    },
  }));
  return buildDesk();
}

function withHandClose<T extends { bot: { lastNote: string | null; skipReentry?: { mint: string; until: string } | null } }>(
  state: T,
  mint: string,
  note: string,
): T {
  return {
    ...state,
    bot: { ...state.bot, lastNote: note, skipReentry: reentryHold(mint) },
  };
}

export async function closeTicket(positionId: string, session?: WalletSession | null): Promise<DeskPayload> {
  const executor = session ? executorFor(session) : undefined;
  const saved = await mutateState(async (state) => {
    const pos = state.positions.find((p) => p.id === positionId);
    if (!pos) return state;
    if (state.config.walletSwaps && pos.signature && pos.side === "long") {
      if (!executor) throw new Error("Connect the wallet on this page to sell this ticket.");
      try {
        const fill = await executor(orderForPosition(pos, "close", state.config.venues));
        const closed = pushEquity(closePosition(state, pos.id, fill.price, "manual", fill.signature));
        return withHandClose(closed, pos.mint, `Closed ${pos.symbol} by hand`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Close failed";
        if (!isAlreadyFlat(message)) throw error;
        const closed = pushEquity(closePosition(state, pos.id, pos.markPrice, "manual"));
        return withHandClose(closed, pos.mint, `Closed ${pos.symbol} — the trading key was already flat`);
      }
    }
    const closed = pushEquity(closePosition(state, pos.id, pos.markPrice, "manual"));
    return withHandClose(closed, pos.mint, `Closed ${pos.symbol} by hand`);
  });
  try {
    return await buildDesk();
  } catch {
    return shellDesk(saved);
  }
}

/** Pull a resting limit bid. A filled bid is left for the next scan to book. */
export async function cancelResting(session: WalletSession): Promise<DeskPayload> {
  const maker = makerDesk(session);
  const saved = await mutateState(async (state) => {
    const resting = state.bot.resting;
    if (!resting) return state;
    try {
      await maker.cancel(resting.orderKey);
    } catch (error) {
      const looked = await maker.lookup(resting).catch(() => "open" as const);
      if (looked === "open") throw error;
      if (looked !== "gone") {
        throw new Error("That bid already filled. It will show as an open position on the next scan.");
      }
    }
    return {
      ...state,
      bot: { ...state.bot, resting: null, lastNote: `Cancelled the ${resting.symbol} limit bid` },
    };
  });
  try {
    return await buildDesk();
  } catch {
    return shellDesk(saved);
  }
}

export async function configureBot(config: Partial<BotConfig>): Promise<DeskPayload> {
  await mutateState((state) => ({
    ...state,
    config: normalizeConfig({ ...state.config, ...config }),
  }));
  return buildDesk();
}
