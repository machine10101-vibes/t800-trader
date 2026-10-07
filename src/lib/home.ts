import { feeHurdlePct } from "@/lib/trading/fees";
import type { BotConfig, BotState, Position, Trade, TradeReason } from "@/lib/types";

/** What a sale was, in words a first-time user reads without a glossary. */
export function exitWords(reason: TradeReason): string {
  const words: Record<TradeReason, string> = {
    target: "Hit the profit goal",
    stop: "Hit the safety stop",
    trail: "Locked in a gain",
    time: "Sold after waiting too long",
    fade: "Sold early as the price turned",
    manual: "You sold it",
    "risk-off": "Sold because the market turned shaky",
    breakout: "Bought on a breakout",
    reclaim: "Bought on a bounce",
  };
  return words[reason] ?? reason;
}

export type HomeMode = "practice" | "real";

export interface HomeStatus {
  tone: "mint" | "amber" | "crimson" | "default";
  title: string;
  detail: string;
}

/** One headline and one sentence for the big status card. */
export function homeStatus(
  bot: Pick<BotState, "running" | "lastNote" | "blocked" | "lastError">,
  config: Pick<BotConfig, "walletSwaps" | "killSwitch">,
  openCount: number,
): HomeStatus {
  if (config.killSwitch) {
    return { tone: "crimson", title: "Emergency stop is on", detail: "No new real trades. You can still sell what you hold." };
  }
  if (!bot.running) {
    return {
      tone: "default",
      title: "Bot is off",
      detail: config.walletSwaps
        ? "Press Start. Your wallet asks you to approve once, then the bot trades on its own."
        : "Press Start to practice with pretend money. Nothing leaves your wallet.",
    };
  }
  if (bot.lastError) return { tone: "crimson", title: "Bot hit a problem", detail: bot.lastError };
  if (openCount > 0) {
    return {
      tone: "mint",
      title: openCount === 1 ? "Holding 1 trade" : `Holding ${openCount} trades`,
      detail: "Each one sells at its safety stop or its profit goal. Winners never sell for less than the fees.",
    };
  }
  const why = bot.blocked.find((line) =>
    /4-hour chart|fee to open|Cooling for|Daily loss|Kill switch|Re-confirm LIVE|trading balance/i.test(line),
  );
  return {
    tone: "amber",
    title: "Watching for a good setup",
    detail: why ?? bot.lastNote ?? "It buys only when the 4-hour chart lines up. A quiet day can pass with no trade.",
  };
}

/** How far a trade is from its stop (0) to its goal (100). */
export function progressToGoal(position: Pick<Position, "side" | "stopPrice" | "targetPrice" | "markPrice">): number {
  const span = position.targetPrice - position.stopPrice;
  if (!Number.isFinite(span) || span === 0) return 50;
  const raw = ((position.markPrice - position.stopPrice) / span) * 100;
  return Math.max(0, Math.min(100, raw));
}

/** The bot's rules, written from the live settings so the words never drift from the code. */
export function planRules(config: Pick<BotConfig, "stopLossPct" | "targetProfitPct" | "lossStreakPause" | "dailyLossLimitPct" | "maxPositions" | "multipliers" | "scratchEnabled">): string[] {
  const hurdle = feeHurdlePct("rules", "TOKEN");
  const rules = [
    "Buys only when the 4-hour chart sets up. It skips the noise in between.",
    `Every trade gets a safety stop ${config.stopLossPct}% below and a profit goal ${config.targetProfitPct}% above the price it paid.`,
    `A winner is never sold until it beats the fees to buy and sell (about ${hurdle.toFixed(2)}% on smaller coins).`,
    `Holds at most ${config.maxPositions} coins at once.`,
    config.lossStreakPause > 0
      ? `After ${config.lossStreakPause} losses in a row it rests for an hour.`
      : "It does not pause after a losing streak.",
    `Stops for the day after a ${config.dailyLossLimitPct}% loss.`,
  ];
  if (config.multipliers.length) rules.push(`SOL can use ${config.multipliers.join("x or ")}x. This loses faster when wrong.`);
  if (config.scratchEnabled) rules.push("Early sells on a red 15 minutes are on.");
  return rules;
}

export interface HomeResults {
  closed: number;
  wins: number;
  netUsd: number;
  bestUsd: number | null;
  worstUsd: number | null;
}

export function homeResults(trades: Pick<Trade, "action" | "pnlUsd">[]): HomeResults {
  const closes = trades.filter((t) => t.action === "close" && t.pnlUsd !== null);
  const pnls = closes.map((t) => t.pnlUsd ?? 0);
  return {
    closed: closes.length,
    wins: pnls.filter((n) => n > 0).length,
    netUsd: pnls.reduce((a, n) => a + n, 0),
    bestUsd: pnls.length ? Math.max(...pnls) : null,
    worstUsd: pnls.length ? Math.min(...pnls) : null,
  };
}
