import { applyControl, tickBot } from "@/lib/trading/bot";
import { mutateState } from "@/lib/store";
import { DEFAULT_CONFIG } from "@/lib/store";
import type { BotConfig } from "@/lib/types";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action?: "start" | "stop" | "reset" | "tick" | "configure";
      config?: Partial<BotConfig>;
    };

    if (body.action === "tick") {
      const state = await tickBot();
      return NextResponse.json({ ok: true, bot: state.bot, portfolio: state.portfolio, positions: state.positions });
    }

    if (body.action === "configure" && body.config) {
      const state = await mutateState((s) => ({
        ...s,
        config: { ...DEFAULT_CONFIG, ...s.config, ...body.config },
      }));
      return NextResponse.json({ ok: true, config: state.config });
    }

    if (body.action === "start" || body.action === "stop" || body.action === "reset") {
      const state = await mutateState((s) => applyControl(s, body.action as "start" | "stop" | "reset"));
      return NextResponse.json({ ok: true, bot: state.bot, portfolio: state.portfolio });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bot control failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
