import { armButton, buildDesk, shellDesk } from "@/lib/desk";
import { executorFor } from "@/lib/solana/swap";
import type { WalletSession } from "@/lib/solana/wallet";
import { adoptLiveEquity, attachWallet, detachWallet, getActiveWallet, loadState, mutateState, normalizeConfig } from "@/lib/store";
import { applyControl, tickBot } from "@/lib/trading/bot";
import { closePosition, pushEquity } from "@/lib/trading/paper";
import type { BotConfig, ChainExecutor, DeskPayload } from "@/lib/types";

export { adoptLiveEquity, attachWallet, detachWallet, getActiveWallet, armButton, shellDesk };

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

export async function controlBot(
  action: "start" | "stop" | "reset" | "tick" | "flatten",
  session?: WalletSession | null,
): Promise<DeskPayload> {
  const executor = session ? executorFor(session) : undefined;
  if (action === "tick") {
    await tickBot(executor);
    return buildDesk();
  }
  if ((action === "flatten" || action === "reset") && executor) {
    await sellSignedPositions(executor);
  }

  await mutateState((state) => {
    const unsold = state.config.walletSwaps && state.positions.some((p) => p.signature && p.side === "long");
    if ((action === "flatten" || action === "reset") && unsold) return state;
    return applyControl(state, action);
  });
  if (action === "start") {
    await tickBot(executor);
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
