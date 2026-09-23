import { buildDesk } from "@/lib/desk";
import { DEFAULT_CONFIG, mutateState } from "@/lib/store";
import { applyControl, tickBot } from "@/lib/trading/bot";
import type { BotConfig, DeskPayload } from "@/lib/types";

export async function loadDesk(force = false): Promise<DeskPayload> {
  return buildDesk(force);
}

export async function controlBot(action: "start" | "stop" | "reset" | "tick"): Promise<DeskPayload> {
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

export async function configureBot(config: Partial<BotConfig>): Promise<DeskPayload> {
  await mutateState((state) => ({
    ...state,
    config: { ...DEFAULT_CONFIG, ...state.config, ...config },
  }));
  return buildDesk();
}
