import type { ChainId } from "@/lib/chain";
import { logicFramesRule } from "@/lib/deskSettings";
import { feeHurdlePct } from "@/lib/trading/fees";
import { dayLossBreached, lossStreakPaused } from "@/lib/trading/risk";
import type { BotConfig, BotState, Portfolio, Position, Trade, TradeReason } from "@/lib/types";
import { priceFmt } from "@/lib/utils";

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
    /chart has not loaded|but the (1|4)-hour|fee to open|Cooling for|Daily loss|Kill switch|Re-confirm LIVE|trading balance/i.test(line),
  );
  return {
    tone: "amber",
    title: "Watching for a good setup",
    detail: why ?? "It trades a 15-minute setup only when the 1-hour and 4-hour charts agree. A quiet day can pass with no trade.",
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
export function planRules(
  config: Pick<BotConfig, "stopLossPct" | "targetProfitPct" | "lossStreakPause" | "dailyLossLimitPct" | "maxPositions" | "multipliers" | "scratchEnabled" | "armFundsUsd" | "buySizeUsd" | "solTradeMode" | "marginOnFourHour" | "cronosQuote" | "logicFrames">,
  chain: ChainId = "solana",
): string[] {
  const hurdle = feeHurdlePct("rules", "TOKEN");
  const fourOn = (config.logicFrames ?? ["15m", "1h", "4h"]).includes("4h");
  const fourHourMargin = chain === "solana" && config.marginOnFourHour && config.solTradeMode !== "spot" && fourOn;
  const charts = logicFramesRule(config.logicFrames ?? ["15m", "1h", "4h"]);
  const rules = [
    fourHourMargin && config.solTradeMode === "margin"
      ? "Finds SOL margin trades on a solid 4-hour setup. Other names are skipped."
      : fourHourMargin
        ? `${charts} SOL margin waits for a solid 4-hour setup.`
        : charts,
    `Every buy gets a safety stop ${config.stopLossPct}% below and a profit goal ${config.targetProfitPct}% above the price it paid.`,
    `A winner is never sold until it beats the fees to buy and sell (about ${hurdle.toFixed(2)}% on smaller coins).`,
    `Holds at most ${config.maxPositions} coins at once.`,
    `Arms with $${config.armFundsUsd ?? 50} and spends $${config.buySizeUsd ?? 10} on each buy.`,
    config.lossStreakPause > 0
      ? `After ${config.lossStreakPause} losses in a row it rests for an hour.`
      : "It does not pause after a losing streak.",
    `Stops for the day after a ${config.dailyLossLimitPct}% loss.`,
  ];
  if (chain === "cronos") {
    rules.push(
      config.cronosQuote === "cro"
        ? "Every ticket spends CRO and sells back to CRO. CRO itself is skipped. Extra size is not used."
        : "Every ticket spends USDC and sells back to USDC. Extra size is not used.",
    );
    rules.push("Every profitable Cronos close automatically sends 10% of the gain to the profit address in the coin that ticket spent.");
  } else if (config.solTradeMode === "margin") {
    rules.push(
      config.marginOnFourHour
        ? "Margin only. SOL perps wait for a solid 4-hour setup. Zebec, Pump, ZEC, and Ray are skipped."
        : `Margin only. SOL uses ${config.multipliers.length ? config.multipliers.join("x or ") + "x" : "a 5x or 10x"} on a Jupiter perp. Other names are skipped.`,
    );
  } else if (config.solTradeMode === "both") {
    rules.push(
      config.marginOnFourHour
        ? "Spot swaps on 15-minute setups. SOL margin waits for a solid 4-hour setup. This loses faster when wrong."
        : `SOL can use ${config.multipliers.length ? config.multipliers.join("x or ") + "x" : "5x or 10x"}. Other names stay spot. This loses faster when wrong.`,
    );
  } else {
    rules.push("Every Solana ticket is a Jupiter spot swap. Extra size is off.");
  }
  if (chain === "solana") {
    rules.push("Every profitable Solana close automatically sends 10% of the gain to the profit address.");
  }
  if (config.scratchEnabled) rules.push("Early sells on a red 15 minutes are on.");
  return rules;
}

/** Honest: GitHub Pages dies with the tab. The local desk runner does not. */
export function alwaysOnNote(runner: boolean): string {
  return runner
    ? "The desk runner on this computer keeps checking after you close this browser. Stop that process to stop the bot."
    : "This page stops checking when you close the tab. On your computer run npm run desk, open that address, then arm if you want the bot to keep going after you close the browser.";
}

export interface HomeResults {
  closed: number;
  wins: number;
  netUsd: number;
  bestUsd: number | null;
  worstUsd: number | null;
}

export type ActivityKind = "target" | "limit" | "wall";

export interface ActivityItem {
  kind: ActivityKind;
  text: string;
}

export interface BotActivity {
  /** One sentence for the top of the section. */
  summary: string;
  targets: ActivityItem[];
  limits: ActivityItem[];
  walls: ActivityItem[];
}

const LIMIT_LINE =
  /kill switch|daily loss|most allowed at once|cooling for an hour|day budget|cooldown after|sector cap|micro book|meme cluster|memes are flattened|confidence below|shorts disabled|insufficient cash|need at least|too small|trading balance is under|two new tickets|no new trade after that fill|only sol can be shorted|no shorts in a defensive|breakouts need|live short/i;

/** Charts and pool prints still arriving. The bot is working, not stuck. */
const WAIT_LINE = /(5-minute|15-minute|1-hour|4-hour) chart has not loaded|pool tape has not arrived/i;

const WALL_LINE =
  /price feeds disagree|could not read the trading balance|cannot ask the wallet|swap was not broadcast|wallet (swap|sell|scale)|missing live mark|signature was declined|re-confirm live|cash could not fill/i;

function lineCore(line: string): string {
  return line.replace(/^[A-Za-z0-9.]+\s+(long|short):\s+/i, "").replace(/^[A-Za-z0-9.]+:\s+/, "");
}

function goalText(position: Position, feeWait: boolean): string {
  const toward = position.side === "long" ? 1 : -1;
  const gap =
    position.entryPrice > 0 ? ((position.targetPrice - position.markPrice) * toward * 100) / position.entryPrice : 0;
  const goal = priceFmt(position.targetPrice);
  const now = priceFmt(position.markPrice);
  const stop = priceFmt(position.stopPrice);
  if (gap <= 0.05) {
    return `${position.symbol} has reached its profit goal at ${goal}. It should sell on the next check.`;
  }
  const fee = feeWait ? " The gain is not bigger than the buy and sell fees yet, so it stays open." : "";
  return `${position.symbol} is waiting for its profit goal at ${goal}. Price is ${now}, about ${gap.toFixed(1)}% short of the goal. Safety stop is ${stop}.${fee}`;
}

/**
 * Splits the live book into the three things a person needs to tell apart:
 * a trade waiting on its profit goal, a limit that stopped new trades, or a wall that stuck the bot.
 */
export function botActivity(input: {
  running: boolean;
  killSwitch: boolean;
  lastError: string | null;
  lastTickAt: string | null;
  ticks: number;
  blocked: string[];
  scanSeconds: number;
  positions: Position[];
  trades: Trade[];
  portfolio: Portfolio;
  config: BotConfig;
  nowMs?: number;
  /** Page load time. A tick from before the refresh is not a stuck wall. */
  pageStartedAt?: number;
  /** Last time this tab became visible. Hidden-tab throttle is not a stuck bot. */
  visibleAt?: number;
  /** The tab is in the background, so Chrome may delay the next check. */
  hidden?: boolean;
  /** A local desk runner is the clock. A quiet UI pull is not a wall. */
  runner?: boolean;
}): BotActivity {
  const now = input.nowMs ?? Date.now();
  const targets: ActivityItem[] = [];
  const limits: ActivityItem[] = [];
  const walls: ActivityItem[] = [];
  const seen = new Set<string>();
  const add = (list: ActivityItem[], kind: ActivityKind, text: string) => {
    const key = `${kind}:${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ kind, text });
  };

  if (input.killSwitch) add(limits, "limit", "Emergency stop is on, so no new trades are sent.");
  if (input.running && dayLossBreached(input.portfolio, input.config)) {
    add(limits, "limit", `Today's loss hit the ${input.config.dailyLossLimitPct}% limit, so no new trades until tomorrow.`);
  }
  if (input.running && input.config.maxPositions > 0 && input.positions.length >= input.config.maxPositions) {
    add(
      limits,
      "limit",
      `Holding ${input.positions.length} coins, the most allowed at once, so no new coin until one sells.`,
    );
  }
  if (input.running && lossStreakPaused(input.trades, input.config.lossStreakPause, now)) {
    add(limits, "limit", `Resting for an hour after ${input.config.lossStreakPause} losses in a row. No new trades until that hour ends.`);
  }

  const feeWait = new Set(
    input.blocked
      .filter((line) => /fee to open and the fee to close/i.test(line))
      .map((line) => line.split(":")[0]?.trim().toUpperCase())
      .filter(Boolean),
  );
  for (const position of input.positions) {
    add(targets, "target", goalText(position, feeWait.has(position.symbol.toUpperCase())));
  }

  for (const line of input.blocked) {
    if (/fee to open and the fee to close/i.test(line)) continue;
    if (/already in this mint/i.test(line)) continue;
    if (WAIT_LINE.test(line)) continue;
    const core = lineCore(line);
    if (LIMIT_LINE.test(line)) {
      if (/most allowed at once|daily loss|cooling for an hour|kill switch/i.test(line)) continue;
      add(limits, "limit", core);
      continue;
    }
    if (WALL_LINE.test(line)) add(walls, "wall", line);
  }

  if (input.lastError) add(walls, "wall", input.lastError);
  if (input.running && input.ticks > 0 && input.lastTickAt && !input.hidden && !input.runner) {
    const at = Date.parse(input.lastTickAt);
    const staleAfter = Math.max(input.scanSeconds * 8_000, 90_000);
    // A tick saved before this page loaded, or before this tab came back, is not a stuck bot.
    const floor = Math.max(
      input.pageStartedAt != null && Number.isFinite(input.pageStartedAt) ? input.pageStartedAt : 0,
      input.visibleAt != null && Number.isFinite(input.visibleAt) ? input.visibleAt : 0,
    );
    const effective = Number.isFinite(at) && (floor === 0 || at >= floor) ? at : floor || at;
    if (Number.isFinite(effective) && now - effective > staleAfter) {
      const secs = Math.round((now - effective) / 1000);
      const age = secs >= 60 ? `${Math.round(secs / 60)} min` : `${secs}s`;
      add(walls, "wall", `The last check was ${age} ago. The bot looks stuck.`);
    }
  }

  let summary = "It is working and waiting for a 15-minute setup the 1-hour and 4-hour charts agree with. Nothing is stopping it.";
  if (!input.running && !input.killSwitch) summary = "The bot is off, so it is not checking for trades.";
  if (targets.length && !limits.length && !walls.length) summary = "Open trades are waiting for their profit goals.";
  if (limits.length && !targets.length && !walls.length) summary = "A limit is blocking new trades.";
  if (limits.length && targets.length && !walls.length) summary = "Open trades are waiting for their profit goals. A limit is blocking new ones.";
  if (walls.length) summary = "Something is stuck. New trades may wait until it clears.";
  if (!input.running && targets.length && !walls.length) summary = "You still hold trades, but the bot is off so it will not sell them at the goal.";

  return { summary, targets, limits, walls };
}

export interface VisibleActivity {
  kind: ActivityKind;
  title: string;
  items: ActivityItem[];
}

/**
 * The section shows the status that is happening now.
 * A stuck check is that status. Otherwise a live limit and a trade waiting on its goal can both show.
 * An empty list is not a status.
 */
export function visibleActivity(activity: BotActivity): VisibleActivity[] {
  if (activity.walls.length) return [{ kind: "wall", title: "Hit a wall", items: activity.walls }];
  const shown: VisibleActivity[] = [];
  if (activity.limits.length) shown.push({ kind: "limit", title: "Stopped by a limit", items: activity.limits });
  if (activity.targets.length) shown.push({ kind: "target", title: "Waiting for a goal", items: activity.targets });
  return shown;
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
