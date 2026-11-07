import type { ChainId } from "@/lib/chain";
import { armButton, buildDesk, shellDesk, startNeedsLiveSignature } from "@/lib/desk";
import { armedFundsUsd, stampQuote } from "@/lib/deskSettings";
import {
  authorizeTrading,
  loadOrCreateTradingKey,
  reclaimTrading,
  sendTradingProfit,
  tradingBudgetAddress,
  tradingFloatInstructions,
  tradingKeypair,
  tradingProfitUsd,
  tradingSnapshot as solanaTradingSnapshot,
  type ArmAuth,
  type TradingSnap,
} from "@/lib/solana/authorize";
import { makerDesk } from "@/lib/solana/limit";
import { executorFor } from "@/lib/solana/swap";
import { orderForPosition, signedOnChain } from "@/lib/trading/leverage";
import { readBalances, type WalletSession } from "@/lib/solana/wallet";
import type { CronosSession } from "@/lib/cronos/wallet";
import type { DashSession } from "@/lib/dash/wallet";
import type { WalletBudget } from "@/lib/trading/risk";
import { adoptLiveEquity, attachWallet, detachWallet, getActiveWallet, loadState, mutateState, normalizeConfig } from "@/lib/store";
import { applyControl, tickBot } from "@/lib/trading/bot";
import { freshBudget, recallBudget, rememberBudget } from "@/lib/trading/budgetCache";
import { applyHandClose, isAlreadyFlat } from "@/lib/trading/close";
import { closePosition, pushEquity } from "@/lib/trading/paper";
import { takeCronosProfitShare } from "@/lib/cronos/share";
import { takeSolProfitShare } from "@/lib/solana/share";
import type { AgentGrant, AppState, BotConfig, ChainExecutor, DeskPayload } from "@/lib/types";
import { tickSessionFor } from "@/lib/deskHost";
import { armLiveSession, disarmLiveSession, resumeLiveSession } from "@/lib/solana/live-session";
import { issueAgentGrant, revokeAgentGrant, viewAgentGrants } from "@/lib/trading/agent";
import { clampAgentMinutes } from "@/lib/trading/agentPermission";
import { signAgentPermission } from "@/lib/solana/agentSign";

export { adoptLiveEquity, attachWallet, detachWallet, getActiveWallet, armButton, shellDesk, startNeedsLiveSignature, tradingProfitUsd };

export type DeskSession = WalletSession | CronosSession | DashSession;

export async function tradingSnapshot(owner: string, chain: ChainId = "solana"): Promise<TradingSnap | null> {
  if (chain === "cronos") {
    const { cronosSnapshot } = await import("@/lib/cronos/trade");
    return cronosSnapshot(owner);
  }
  if (chain === "dash") {
    const { dashSnapshot } = await import("@/lib/dash/trade");
    return dashSnapshot(owner);
  }
  return solanaTradingSnapshot(owner);
}

async function afterWinningClose(state: AppState, chain: ChainId, live: boolean): Promise<AppState> {
  if (chain === "solana") return takeSolProfitShare(state, { live, owner: getActiveWallet("solana") });
  if (chain === "cronos") return takeCronosProfitShare(state, { live, owner: getActiveWallet("solana") });
  if (chain === "dash") {
    const { takeDashProfitShare } = await import("@/lib/dash/share");
    return takeDashProfitShare(state, { live, owner: getActiveWallet("solana") });
  }
  return state;
}

async function sellSignedPositions(executor: ChainExecutor, chain: ChainId): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const state = await loadState(chain);
    const pos = state.positions.find((p) => signedOnChain(p));
    if (!pos) return;
    await mutateState(async (current) => {
      const still = current.positions.find((p) => p.id === pos.id);
      if (!still || !signedOnChain(still)) return current;
      try {
        const fill = await executor(stampQuote(orderForPosition(still, "close", current.config.venues), current.config));
        return afterWinningClose(pushEquity(closePosition(current, still.id, fill.price, "manual", fill.signature)), chain, true);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!isAlreadyFlat(message)) throw error;
        return pushEquity(closePosition(current, still.id, still.markPrice, "manual"));
      }
    }, chain);
  }
}

async function budgetFor(session?: WalletSession | null): Promise<WalletBudget | null> {
  const owner = session?.address ?? getActiveWallet("solana");
  if (!owner) return null;
  const bot = tradingKeypair(owner);
  const address = tradingBudgetAddress(owner);
  const cached = freshBudget("solana", address);
  if (cached) return cached;
  try {
    let live = await readBalances(address);
    if (bot && live.usdc < 1 && live.sol < 0.01) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      live = await readBalances(address);
    }
    return rememberBudget("solana", address, {
      usdc: live.usdc,
      sol: live.sol,
      solPriceUsd: live.solPriceUsd ?? session?.solPriceUsd ?? 0,
    });
  } catch (error) {
    const stale = recallBudget("solana", address);
    if (stale) return stale;
    if (!bot) {
      return {
        usdc: session?.usdc ?? 0,
        sol: session?.sol ?? 0,
        solPriceUsd: session?.solPriceUsd ?? 0,
      };
    }
    const message = error instanceof Error ? error.message : "balance read failed";
    throw new Error(`Could not read the SOL trading key, so no swap was sent. ${message}`);
  }
}

async function dashLive(session: DeskSession | null | undefined) {
  const { authorizeDash, dashBudget, dashExecutor } = await import("@/lib/dash/trade");
  const { readDashBalances } = await import("@/lib/dash/wallet");
  const dash = session as DashSession | null | undefined;
  return {
    executor: dash?.nearAccountId ? dashExecutor(dash) : undefined,
    maker: null as ReturnType<typeof makerDesk> | null,
    budget: () => dashBudget(dash),
    authorize: (armFundsUsd?: number, quote?: "usdc" | "cro") => {
      void armFundsUsd;
      void quote;
      return authorizeDash(dash as DashSession);
    },
    confirmDisarm: () => Promise.resolve(),
    reclaim: (keep: number) => {
      void keep;
      return Promise.resolve(null as string | null);
    },
    read: (address: string) => readDashBalances(address),
    hasKey: () => Boolean(dash?.nearAccountId && dash.dashAccount),
    sendProfit: (principal: number, keep: number) => {
      void principal;
      void keep;
      return Promise.resolve(null as string | null);
    },
  };
}

async function cronosLive(session: DeskSession | null | undefined) {
  const { authorizeCronos, confirmCronosDisarm, cronosBudget, cronosExecutor, reclaimCronos, sendCronosProfit } =
    await import("@/lib/cronos/trade");
  const cronos = session as CronosSession | null | undefined;
  return {
    executor: cronos ? cronosExecutor(cronos) : undefined,
    maker: null as ReturnType<typeof makerDesk> | null,
    budget: () => cronosBudget(cronos),
    authorize: (armFundsUsd?: number, cronosQuote?: "usdc" | "cro") =>
      authorizeCronos(cronos as CronosSession, armFundsUsd ?? 50, {
        cronosQuote,
        croPriceUsd: cronos?.solPriceUsd ?? 0,
      }),
    confirmDisarm: () => confirmCronosDisarm(cronos as CronosSession),
    reclaim: (keep: number) => reclaimCronos(cronos?.address ?? "", keep),
    read: (address: string) => import("@/lib/cronos/wallet").then((mod) => mod.readCronosBalances(address)),
    hasKey: () => Boolean(cronos),
    sendProfit: (principal: number, keep: number) => sendCronosProfit(cronos?.address ?? "", principal, keep),
  };
}

export async function confirmLiveMode(chain: ChainId = "solana"): Promise<DeskPayload> {
  armLiveSession();
  const state = await mutateState((state) => ({
    ...state,
    config: normalizeConfig({
      ...state.config,
      executionMode: "live",
      walletSwaps: true,
      killSwitch: false,
    }),
    bot: { ...state.bot, lastNote: "LIVE armed this session — each new ticket still needs the trading key" },
  }), chain);
  return shellDesk(state);
}

export async function setPaperMode(chain: ChainId = "solana"): Promise<DeskPayload> {
  disarmLiveSession();
  await mutateState((state) => ({
    ...state,
    config: normalizeConfig({ ...state.config, executionMode: "paper", walletSwaps: false }),
    bot: { ...state.bot, lastNote: "PAPER — fills stay in this browser" },
  }), chain);
  return buildDesk(false, chain);
}

export async function controlBot(
  action: "start" | "stop" | "reset" | "tick" | "flatten" | "kill",
  session?: DeskSession | null,
  chain: ChainId = "solana",
): Promise<DeskPayload> {
  const resolved = action === "tick" ? tickSessionFor(chain, session) : session ?? null;
  const solana = chain === "solana" ? (resolved as WalletSession | null | undefined) : null;
  const liveKit = chain === "cronos" ? await cronosLive(resolved) : chain === "dash" ? await dashLive(resolved) : null;
  const executor = liveKit ? liveKit.executor : solana ? executorFor(solana) : undefined;
  const maker = liveKit ? liveKit.maker : solana ? makerDesk(solana) : null;
  const budget = () => (liveKit ? liveKit.budget() : budgetFor(solana));
  if (action === "kill") {
    disarmLiveSession();
    await mutateState((state) => applyControl(state, "kill"), chain);
    return buildDesk(false, chain);
  }
  if (action === "tick") {
    const state = await loadState(chain);
    if (state.config.walletSwaps && state.bot.running) resumeLiveSession();
    const live = state.config.walletSwaps && state.bot.running;
    let funds: WalletBudget | null = null;
    if (live) {
      try {
        funds = await budget();
      } catch {
        const owner = session?.address ?? getActiveWallet(chain);
        const address = owner
          ? chain === "cronos"
            ? (await import("@/lib/cronos/trade")).cronosBudgetAddress(owner)
            : chain === "dash"
              ? owner
              : tradingBudgetAddress(owner)
          : "";
        funds = address ? recallBudget(chain, address) : null;
      }
    }
    await tickBot(executor, funds, live ? maker : null, chain);
    return buildDesk(false, chain);
  }
  if (action === "stop" && liveKit && session) {
    await liveKit.confirmDisarm();
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
    const open = (await loadState(chain)).positions.some((p) => signedOnChain(p));
    if (liveKit && chain !== "dash") {
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
    if (startNeedsLiveSignature(state.config.walletSwaps)) {
      if (liveKit) auth = await liveKit.authorize(armedFundsUsd(state.config), state.config.cronosQuote);
      else auth = await authorizeTrading(solana as WalletSession, armedFundsUsd(state.config));
    }
  }

  await mutateState((state) => {
    const unsold = state.config.walletSwaps && state.positions.some((p) => signedOnChain(p));
    if ((action === "flatten" || action === "reset") && unsold) return state;
    const controlled = applyControl(state, action, chain);
    const next =
      (chain === "cronos" || chain === "dash") && action === "start" && auth
        ? {
            ...controlled,
            config: normalizeConfig({
              ...controlled.config,
              walletSwaps: true,
              executionMode: "live",
              killSwitch: false,
            }),
          }
        : controlled;
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
        : chain === "dash"
          ? await import("@/lib/dash/trade").then((mod) => mod.dashSnapshot(session.address))
          : await readBalances(tradingBudgetAddress(session.address));
    await baselineTradingPrincipal(held?.equityUsd ?? 0, chain);
    throw new Error("No trading profit to send yet. The bot keeps the balance it is still using.");
  }
  const open = state.positions.some((p) => signedOnChain(p));
  if (chain === "dash") {
    throw new Error("Dash keeps the balance in NEAR Mobile. A winning close sends the 10% share on its own.");
  }
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

export async function closeTicket(positionId: string, session?: DeskSession | null, chain: ChainId = "solana"): Promise<DeskPayload> {
  const executor =
    chain === "cronos"
      ? session
        ? (await import("@/lib/cronos/trade")).cronosExecutor(session as CronosSession)
        : undefined
      : chain === "dash"
        ? session
          ? (await import("@/lib/dash/trade")).dashExecutor(session as DashSession)
          : undefined
        : session
          ? executorFor(session as WalletSession)
          : undefined;
  const saved = await mutateState(async (state) => {
    const pos = state.positions.find((p) => p.id === positionId);
    if (!pos) return state;
    if (signedOnChain(pos)) {
      if (!executor) throw new Error("Connect the wallet on this page to sell this ticket.");
      try {
        const fill = await executor(stampQuote(orderForPosition(pos, "close", state.config.venues), state.config));
        return afterWinningClose(applyHandClose(state, pos.id, fill.price, fill.signature), chain, true);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Close failed";
        if (!isAlreadyFlat(message)) throw error;
        return applyHandClose(state, pos.id, pos.markPrice, undefined, `Closed ${pos.symbol} — the trading key was already flat`);
      }
    }
    return afterWinningClose(applyHandClose(state, pos.id, pos.markPrice), chain, false);
  }, chain);
  try {
    return await buildDesk(false, chain);
  } catch {
    return shellDesk(saved);
  }
}

/** Pull a resting limit bid. A filled bid is left for the next scan to book. */
export async function cancelResting(session: DeskSession, chain: ChainId = "solana"): Promise<DeskPayload> {
  if (chain === "cronos" || chain === "dash") return buildDesk(false, chain);
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

export type AgentGrantView = Pick<AgentGrant, "id" | "label" | "createdAt" | "revokedAt">;

/** Create a Solana Grok code. The plaintext is returned once and is not written to the book. */
export async function issueSolAgentCode(): Promise<{ ok: true; code: string; grants: AgentGrantView[] } | { ok: false; error: string }> {
  let code = "";
  let error = "";
  const state = await mutateState(async (current) => {
    const issued = await issueAgentGrant(current);
    if (!issued.ok) {
      error = issued.error;
      return current;
    }
    code = issued.code;
    return issued.state;
  }, "solana");
  if (!code) return { ok: false, error: error || "Could not create a Grok code." };
  return { ok: true, code, grants: viewAgentGrants(state) };
}

export async function revokeSolAgentCode(grantId: string): Promise<AgentGrantView[]> {
  const state = await mutateState((current) => revokeAgentGrant(current, grantId), "solana");
  return viewAgentGrants(state);
}

/**
 * The wallet approves one transaction for the minutes the user picked.
 * Until that window ends, manual buys and sells do not ask the wallet again.
 * On real money, the same transaction loads the trading key when it is short.
 */
export async function enableSolAgent(session: WalletSession, minutes: number): Promise<DeskPayload> {
  const chosen = clampAgentMinutes(minutes);
  const expiresAt = new Date(Date.now() + chosen * 60_000).toISOString();
  const book = await loadState("solana");
  const trader = loadOrCreateTradingKey(session.address);
  const live = Boolean(book.config.walletSwaps);
  const funded = live ? await tradingFloatInstructions(session, trader.publicKey, armedFundsUsd(book.config)) : [];
  const signed = await signAgentPermission(session, expiresAt, {
    delegate: trader.publicKey.toBase58(),
    extraInstructions: funded,
  });
  const after = live && funded.length ? await readBalances(trader.publicKey.toBase58()).catch(() => null) : null;
  const state = await mutateState((current) => ({
    ...current,
    bot: {
      ...current.bot,
      agentSession: { ...signed, minutes: chosen },
      ...(live
        ? {
            swapBot: trader.publicKey.toBase58(),
            ...(funded.length
              ? {
                  swapAuthSignature: signed.signature,
                  swapPrincipalUsd: current.bot.swapPrincipalUsd ?? after?.equityUsd ?? current.bot.swapPrincipalUsd,
                }
              : {}),
          }
        : {}),
      lastNote: `AI agent has full range for manual trading for ${chosen} minutes. The wallet approved that transaction.`,
    },
  }), "solana");
  return shellDesk(state);
}

export async function disableSolAgent(): Promise<DeskPayload> {
  const state = await mutateState((current) => ({
    ...current,
    bot: {
      ...current.bot,
      agentSession: null,
      agentOrder: null,
      lastNote: "AI agent manual trading is off.",
    },
  }), "solana");
  return shellDesk(state);
}
