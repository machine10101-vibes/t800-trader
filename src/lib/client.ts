import { armButton, buildDesk, shellDesk } from "@/lib/desk";
import { authorizeTrading, reclaimTrading, tradingBudgetAddress, tradingKeypair, tradingSnapshot } from "@/lib/solana/authorize";
import { executorFor } from "@/lib/solana/swap";
import { readBalances, type WalletSession } from "@/lib/solana/wallet";
import type { WalletBudget } from "@/lib/trading/risk";
import { adoptLiveEquity, attachWallet, detachWallet, getActiveWallet, loadState, mutateState, normalizeConfig } from "@/lib/store";
import { applyControl, tickBot } from "@/lib/trading/bot";
import { closePosition, pushEquity } from "@/lib/trading/paper";
import type { BotConfig, ChainExecutor, DeskPayload } from "@/lib/types";

export { adoptLiveEquity, attachWallet, detachWallet, getActiveWallet, armButton, shellDesk, tradingSnapshot };

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
      const fill = await executor({
        kind: "close",
        side: still.side,
        mint: still.mint,
        symbol: still.symbol,
        notionalUsd: still.qty * still.markPrice,
        qty: still.qty,
        price: still.markPrice,
        tokenDecimals: still.tokenDecimals,
        venues: current.config.venues,
      });
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
  if (action === "tick") {
    const state = await loadState();
    await tickBot(executor, state.config.walletSwaps ? await budgetFor(session) : null);
    return buildDesk();
  }
  if ((action === "stop" || action === "flatten" || action === "reset") && executor) {
    await sellSignedPositions(executor);
  }
  let reclaimed: string | null = null;
  if ((action === "stop" || action === "flatten" || action === "reset") && session) {
    const open = (await loadState()).positions.some((p) => p.signature && p.side === "long");
    reclaimed = await reclaimTrading(session.address, open ? 0.015 : 0);
  }

  let auth: { signature: string; botAddress: string; reused: boolean } | null = null;
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
          lastNote: action === "stop" ? `Disarmed — returned ${short}` : `Book flattened — returned ${short}`,
        },
      };
    }
    if (action !== "start" || !auth) return next;
    const short = auth.reused ? "trading key already funded" : `signed ${auth.signature.slice(0, 8)}…`;
    return {
      ...next,
      bot: {
        ...next.bot,
        swapAuthSignature: auth.signature,
        swapBot: auth.botAddress,
        lastNote: `Armed — ${short}. Swaps send from that signature.`,
      },
    };
  });
  if (action === "start") {
    const state = await loadState();
    await tickBot(executor, state.config.walletSwaps ? await budgetFor(session) : null);
  }
  return buildDesk();
}

export async function closeTicket(positionId: string, session?: WalletSession | null): Promise<DeskPayload> {
  const executor = session ? executorFor(session) : undefined;
  await mutateState(async (state) => {
    const pos = state.positions.find((p) => p.id === positionId);
    if (!pos) return state;
    if (state.config.walletSwaps && pos.signature && pos.side === "long") {
      if (!executor) throw new Error("Connect the wallet on this page to sell this ticket.");
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
      return pushEquity(closePosition(state, pos.id, fill.price, "manual", fill.signature));
    }
    return pushEquity(closePosition(state, pos.id, pos.markPrice, "manual"));
  });
  return buildDesk();
}

export async function configureBot(config: Partial<BotConfig>): Promise<DeskPayload> {
  await mutateState((state) => ({
    ...state,
    config: normalizeConfig({ ...state.config, ...config }),
  }));
  return buildDesk();
}
