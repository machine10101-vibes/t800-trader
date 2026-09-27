import { buildDesk } from "@/lib/desk";
import { attachWallet, detachWallet, getActiveWallet, mutateState, normalizeConfig } from "@/lib/store";
import type { LiveRuntime } from "@/lib/solana/live";
import { armLiveSession, disarmLiveSession } from "@/lib/solana/live-session";
import { applyControl, closeOpenPosition, tickBot } from "@/lib/trading/bot";
import type { BotConfig, DeskPayload } from "@/lib/types";

export { attachWallet, detachWallet, getActiveWallet };

let liveRuntime: LiveRuntime | null = null;

export function setLiveRuntime(runtime: LiveRuntime | null): void {
  liveRuntime = runtime;
}

export function getLiveRuntime(): LiveRuntime | null {
  return liveRuntime;
}

export async function loadDesk(force = false): Promise<DeskPayload> {
  return buildDesk(force);
}

export async function controlBot(action: "start" | "stop" | "reset" | "tick" | "kill"): Promise<DeskPayload> {
  if (action === "tick") {
    await tickBot(liveRuntime ?? undefined);
    return buildDesk();
  }
  if (action === "kill") {
    disarmLiveSession();
    await mutateState((state) => applyControl(state, "kill"));
    return buildDesk();
  }

  await mutateState((state) => applyControl(state, action));
  if (action === "start") {
    await tickBot(liveRuntime ?? undefined);
  }
  return buildDesk();
}

export async function configureBot(config: Partial<BotConfig>): Promise<DeskPayload> {
  await mutateState((state) => ({
    ...state,
    config: normalizeConfig({ ...state.config, ...config }),
  }));
  return buildDesk();
}

export async function confirmLiveMode(): Promise<DeskPayload> {
  armLiveSession();
  return configureBot({ executionMode: "live", killSwitch: false });
}

export async function setPaperMode(): Promise<DeskPayload> {
  disarmLiveSession();
  return configureBot({ executionMode: "paper" });
}

export async function closeDeskPosition(positionId: string): Promise<DeskPayload> {
  await closeOpenPosition(positionId, liveRuntime ?? undefined);
  return buildDesk();
}
