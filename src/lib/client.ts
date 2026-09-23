import { buildDesk } from "@/lib/desk";
import { adoptLiveEquity, attachWallet, DEFAULT_CONFIG, detachWallet, getActiveWallet, mutateState } from "@/lib/store";
import { applyControl, tickBot } from "@/lib/trading/bot";
import { closePosition, pushEquity } from "@/lib/trading/paper";
import type { BotConfig, DeskPayload } from "@/lib/types";

export { adoptLiveEquity, attachWallet, detachWallet, getActiveWallet };

export async function loadDesk(force = false): Promise<DeskPayload> {
  return buildDesk(force);
}

export async function controlBot(action: "start" | "stop" | "reset" | "tick" | "flatten"): Promise<DeskPayload> {
  if (action === "tick") {
    await tickBot();
    return buildDesk();
  }

  await mutateState((state) => applyControl(state, action));
  if (action === "start") {
    await tickBot();
  }
  return buildDesk();
}

export async function closeTicket(positionId: string): Promise<DeskPayload> {
  await mutateState((state) => {
    const pos = state.positions.find((p) => p.id === positionId);
    if (!pos) return state;
    return pushEquity(closePosition(state, pos.id, pos.markPrice, "manual"));
  });
  return buildDesk();
}

export async function configureBot(config: Partial<BotConfig>): Promise<DeskPayload> {
  await mutateState((state) => ({
    ...state,
    config: { ...DEFAULT_CONFIG, ...state.config, ...config },
  }));
  return buildDesk();
}
