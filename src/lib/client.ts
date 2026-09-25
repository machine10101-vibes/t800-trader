import type { ChainId } from "@/lib/chain";
import { armButton, buildDesk, shellDesk } from "@/lib/desk";
import {
  authorizeTrading,
  reclaimTrading,
  sendTradingProfit,
  tradingBudgetAddress,
  tradingKeypair,
  tradingProfitUsd,
  tradingSnapshot as solanaTradingSnapshot,
  type ArmAuth,
  type TradingSnap,
} from "@/lib/solana/authorize";
import { makerDesk } from "@/lib/solana/limit";
import { executorFor } from "@/lib/solana/swap";
import { orderForPosition } from "@/lib/trading/leverage";
import { readBalances, type WalletSession } from "@/lib/solana/wallet";
import type { CronosSession } from "@/lib/cronos/wallet";
import type { WalletBudget } from "@/lib/trading/risk";
import { adoptLiveEquity, attachWallet, detachWallet, getActiveWallet, loadState, mutateState, normalizeConfig } from "@/lib/store";
import { applyControl, tickBot } from "@/lib/trading/bot";
import { isAlreadyFlat, reentryHold } from "@/lib/trading/close";
import { closePosition, pushEquity } from "@/lib/trading/paper";
import type { BotConfig, ChainExecutor, DeskPayload } from "@/lib/types";

export { adoptLiveEquity, attachWallet, detachWallet, getActiveWallet, armButton, shellDesk, tradingProfitUsd };

export type DeskSession = WalletSession | CronosSession;

export async function tradingSnapshot(owner: string, chain: ChainId = "solana"): Promise<TradingSnap | null> {
  if (chain === "cronos") {
    const { cronosSnapshot } = await import("@/lib/cronos/trade");
    return cronosSnapshot(owner);
  }
  return solanaTradingSnapshot(owner);
}

async function sellSignedPositions(executor: ChainExecutor, chain: ChainId): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const state = await loadState(chain);
    if (!state.config.walletSwaps) return;
    const pos = state.positions.find((p) => p.signature && p.side === "long");
    if (!pos) return;
    await mutateState(async (current) => {
      const still = current.positions.find((p) => p.id === pos.id);
      if (!still?.signature || still.side !== "long") return current;
      const fill = await executor(orderForPosition(still, "close", current.config.venues));
      return pushEquity(closePosition(current, still.id, fill.price, "manual", fill.signature));
    }, chain);
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

async function cronosLive(session: DeskSession | null | undefined) {
  const { authorizeCronos, cronosBudget, cronosExecutor, reclaimCronos, sendCronosProfit } = await import("@/lib/cronos/trade");
  const cronos = session as CronosSession | null | undefined;
  return {
    executor: cronos ? cronosExecutor(cronos) : undefined,
    maker: null as ReturnType<typeof makerDesk> | null,
    budget: () => cronosBudget(cronos),
    authorize: () => authorizeCronos(cronos as CronosSession),
    reclaim: (keep: number) => reclaimCronos(cronos?.address ?? "", keep),
    read: (address: string) => import("@/lib/cronos/wallet").then((mod) => mod.readCronosBalances(address)),
    hasKey: () => Boolean(cronos),
    sendProfit: (principal: number, keep: number) => sendCronosProfit(cronos?.address ?? "", principal, keep),
  };
}

export async function controlBot(
  action: "start" | "stop" | "reset" | "tick" | "flatten",
  session?: DeskSession | null,
  chain: ChainId = "solana",
): Promise<DeskPayload> {
  const solana = chain === "solana" ? (session as WalletSession | null | undefined) : null;
  const liveKit = chain === "cronos" ? await cronosLive(session) : null;
  const executor = liveKit ? liveKit.executor : solana ? executorFor(solana) : undefined;
  const maker = liveKit ? liveKit.maker : solana ? makerDesk(solana) : null;
  const budget = () => (liveKit ? liveKit.budget() : budgetFor(solana));
  if (action === "tick") {
    const state = await loadState(chain);
    const live = state.config.walletSwaps && state.bot.running;
    await tickBot(executor, live ? await budget() : null, live ? maker : null, chain);
    return buildDesk(false, chain);
  }
  if ((action === "stop" || action === "flatten" || action === "reset") && maker) {
    const resting = (await loadState(chain)).bot.resting;
    if (resting) await maker.cancel(resting.orderKey).catch(() => undefined);
  }
  if ((action === "stop" || action === "flatten" || action === "reset") && executor) {
    await sellSignedPositions(executor, chain);
  }
  let reclaimed: string | null = null;
  let principalAfter: number | null = null;
  if ((action === "stop" || action === "flatten" || action === "reset") && session) {
    const open = (await loadState(chain)).positions.some((p) => p.signature && p.side === "long");
    if (liveKit) {
      const { cronosBudgetAddress } = await import("@/lib/cronos/trade");
      const address = cronosBudgetAddress(session.address);
      const before = await liveKit.read(address).catch(() => null);
      reclaimed = await liveKit.reclaim(open ? 0.5 : 0);
      const after = await liveKit.read(address).catch(() => null);
      const returned = Math.max(0, (before?.equityUsd ?? 0) - (after?.equityUsd ?? 0));
      const prior = (await loadState(chain)).bot.swapPrincipalUsd;
      principalAfter = before ? Math.max(0, (prior ?? before.equityUsd) - returned) : 0;
    } else if (solana) {
      const bot = tradingKeypair(solana.address);
      const before = bot ? await readBalances(bot.publicKey.toBase58()).catch(() => null) : null;
      reclaimed = await reclaimTrading(solana.address, open ? 0.015 : 0);
      if (bot) {
        const after = await readBalances(bot.publicKey.toBase58()).catch(() => null);
        const returned = Math.max(0, (before?.equityUsd ?? 0) - (after?.equityUsd ?? 0));
        const prior = (await loadState(chain)).bot.swapPrincipalUsd;
        principalAfter = Math.max(0, (prior ?? before?.equityUsd ?? 0) - returned);
      } else {
        principalAfter = 0;
      }
    }
  }

  let auth: ArmAuth | null = null;
  if (action === "start" && session) {
    const state = await loadState(chain);
    if (state.config.walletSwaps) auth = liveKit ? await liveKit.authorize() : await authorizeTrading(solana as WalletSession);
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
    const short = auth.reused ? "trading account already holds the balance, so nothing else was moved" : `signed ${auth.signature.slice(0, 8)}…`;
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
  }, chain);
  if (action === "start") {
    const state = await loadState(chain);
    await tickBot(executor, state.config.walletSwaps ? await budget() : null, state.config.walletSwaps ? maker : null, chain);
  }
  return buildDesk(false, chain);
}

/** Record the current trading equity once, so an older funded key is not treated as profit. */
export async function baselineTradingPrincipal(equityUsd: number, chain: ChainId = "solana"): Promise<boolean> {
  if (!(equityUsd >= 1)) return false;
  let wrote = false;
  await mutateState((state) => {
    if (state.bot.swapPrincipalUsd != null) return state;
    wrote = true;
    return { ...state, bot: { ...state.bot, swapPrincipalUsd: equityUsd } };
  }, chain);
  return wrote;
}

/** Move cash profit from the trading key back to the connected wallet. The deposit stays. */
export async function withdrawTradingProfit(session: DeskSession, chain: ChainId = "solana"): Promise<DeskPayload> {
  const state = await loadState(chain);
  const principal = state.bot.swapPrincipalUsd;
  if (principal == null) {
    const held =
      chain === "cronos"
        ? await import("@/lib/cronos/trade").then((mod) => mod.cronosSnapshot(session.address))
        : await readBalances(tradingBudgetAddress(session.address));
    await baselineTradingPrincipal(held?.equityUsd ?? 0, chain);
    throw new Error("No trading profit to send yet. The bot keeps the balance it is still using.");
  }
  const open = state.positions.some((p) => p.signature && p.side === "long");
  const sent =
    chain === "cronos"
      ? await import("@/lib/cronos/trade").then((mod) => mod.sendCronosProfit(session.address, principal, open ? 0.5 : 0.3))
      : await sendTradingProfit((session as WalletSession).address, principal, open ? 0.015 : 0.01);
  await mutateState((current) => ({
    ...current,
    bot: {
      ...current.bot,
      lastNote: `Sent $${sent.profitUsd.toFixed(2)} profit to the wallet · ${sent.signature.slice(0, 8)}…`,
    },
  }), chain);
  return buildDesk(false, chain);
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

export async function closeTicket(positionId: string, session?: DeskSession | null, chain: ChainId = "solana"): Promise<DeskPayload> {
  const executor =
    chain === "cronos"
      ? session
        ? (await import("@/lib/cronos/trade")).cronosExecutor(session as CronosSession)
        : undefined
      : session
        ? executorFor(session as WalletSession)
        : undefined;
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
  }, chain);
  try {
    return await buildDesk(false, chain);
  } catch {
    return shellDesk(saved);
  }
}

/** Pull a resting limit bid. A filled bid is left for the next scan to book. */
export async function cancelResting(session: DeskSession, chain: ChainId = "solana"): Promise<DeskPayload> {
  if (chain === "cronos") return buildDesk(false, chain);
  const maker = makerDesk(session as WalletSession);
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
  }, chain);
  try {
    return await buildDesk(false, chain);
  } catch {
    return shellDesk(saved);
  }
}

export async function configureBot(config: Partial<BotConfig>, chain: ChainId = "solana"): Promise<DeskPayload> {
  await mutateState((state) => ({
    ...state,
    config: normalizeConfig({ ...state.config, ...config }),
  }), chain);
  return buildDesk(false, chain);
}

export async function loadDesk(force = false, chain: ChainId = "solana"): Promise<DeskPayload> {
  return buildDesk(force, chain);
}
