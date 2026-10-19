import type { ChainId } from "@/lib/chain";
import { armedFundsUsd, logicFramesRule, ruleOn, ticketBuyUsd } from "@/lib/deskSettings";
import { feeHurdlePct, swapFeeUsd, usageFeeUsd } from "@/lib/trading/fees";
import { dayLossBreached, lossStreakResumeAt, nextSessionMs } from "@/lib/trading/risk";
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
  config: Pick<
    BotConfig,
    | "stopLossPct"
    | "targetProfitPct"
    | "lossStreakPause"
    | "dailyLossLimitPct"
    | "maxPositions"
    | "multipliers"
    | "scratchEnabled"
    | "armFundsUsd"
    | "buySizeUsd"
    | "solTradeMode"
    | "marginOnFourHour"
    | "cronosQuote"
    | "dashQuote"
    | "logicFrames"
    | "rulesOn"
  >,
  chain: ChainId = "solana",
): string[] {
  const hurdle = feeHurdlePct("rules", "TOKEN");
  const fourOn = (config.logicFrames ?? ["15m", "1h", "4h"]).includes("4h");
  const fourHourMargin = chain === "solana" && config.marginOnFourHour && config.solTradeMode !== "spot" && fourOn;
  const charts = logicFramesRule(config.logicFrames ?? ["15m", "1h", "4h"]);
    const rules = [
    "When Bitcoin and Ethereum are both quietly red and Fear & Greed is calm, it stands down. A hard Bitcoin selloff, a hard chain selloff, or a fearful reading does the same.",
    fourHourMargin && config.solTradeMode === "margin"
      ? "Finds SOL margin trades on a solid 4-hour setup. Other names are skipped."
      : fourHourMargin
        ? `${charts} SOL margin waits for a solid 4-hour setup.`
        : charts,
    ruleOn(config, "stopLoss") && ruleOn(config, "targetProfit")
      ? `Every buy gets a safety stop ${config.stopLossPct}% below and a profit goal ${config.targetProfitPct}% above the price it paid.`
      : ruleOn(config, "stopLoss")
        ? `Every buy gets a safety stop ${config.stopLossPct}% below the price it paid. The profit goal is off.`
        : ruleOn(config, "targetProfit")
          ? `New buys do not use a safety stop. The profit goal is ${config.targetProfitPct}% above the price it paid.`
          : "New buys do not use a safety stop or a profit goal.",
    `A winner is never sold until it beats the fees to buy and sell (about ${hurdle.toFixed(2)}% on smaller coins).`,
    ruleOn(config, "maxPositions")
      ? `Holds at most ${config.maxPositions} coins at once.`
      : "There is no cap on how many coins it can hold at once.",
    `Arms with $${armedFundsUsd(config)} and spends $${ticketBuyUsd(config)} on each buy.`,
    ruleOn(config, "lossStreak") && config.lossStreakPause > 0
      ? `After ${config.lossStreakPause} losses in a row it rests for an hour.`
      : "It does not pause after a losing streak.",
    ruleOn(config, "dailyLoss")
      ? `Stops for the day after a ${config.dailyLossLimitPct}% loss.`
      : "It does not stop for the day after a loss.",
  ];
  if (chain === "cronos") {
    rules.push(
      config.cronosQuote === "cro"
        ? "Every ticket spends CRO and sells back to CRO. CRO itself is skipped. Extra size is not used."
        : "Every ticket spends USDC and sells back to USDC. Extra size is not used.",
    );
    rules.push("Every profitable Cronos close automatically sends 10% of the gain to the profit address in the coin that ticket spent.");
  } else if (chain === "dash") {
    rules.push(
      config.dashQuote === "dash"
        ? "Every ticket spends DASH and sells back to DASH. DASH itself is skipped. Extra size is not used."
        : "Every ticket spends USDT and sells back to USDT. Extra size is not used.",
    );
    rules.push("Every profitable Dash close automatically sends 10% of the gain to the profit address. USDT tickets pay USDC. DASH tickets pay SOL of the same dollars.");
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
  /** Epoch ms when this limit lifts and the bot can begin again. */
  resumeAt?: number;
}

/** Open time for a finished result. A stamped close wins. Otherwise the latest open of that coin at or before the close. */
export function openedAtFor(
  close: Pick<Trade, "mint" | "at" | "openedAt">,
  trades: Pick<Trade, "mint" | "action" | "at">[],
): string | null {
  if (close.openedAt) return close.openedAt;
  const closeMs = Date.parse(close.at);
  if (!Number.isFinite(closeMs)) return null;
  let bestMs = Number.NEGATIVE_INFINITY;
  let best: string | null = null;
  for (const trade of trades) {
    if (trade.action !== "open" || trade.mint !== close.mint) continue;
    const ms = Date.parse(trade.at);
    if (!Number.isFinite(ms) || ms > closeMs || ms < bestMs) continue;
    bestMs = ms;
    best = trade.at;
  }
  return best;
}

/** Local date and time for an open or a close. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return "—";
  return when.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface ResultFees {
  /** Pool fee to open this slice plus the fee to close it. */
  swapUsd: number;
  /** Ten percent of a gain. Zero on a loss. */
  usageUsd: number;
}

type FeeFill = Pick<Trade, "mint" | "symbol" | "action" | "qty" | "price" | "at" | "swapFeeUsd" | "leverage">;

function openTradeFor(close: Pick<Trade, "mint" | "at">, trades: FeeFill[]): FeeFill | null {
  const closeMs = Date.parse(close.at);
  if (!Number.isFinite(closeMs)) return null;
  let bestMs = Number.NEGATIVE_INFINITY;
  let best: FeeFill | null = null;
  for (const trade of trades) {
    if (trade.action !== "open" || trade.mint !== close.mint) continue;
    const ms = Date.parse(trade.at);
    if (!Number.isFinite(ms) || ms > closeMs || ms < bestMs) continue;
    bestMs = ms;
    best = trade;
  }
  return best;
}

function stampedOrEstimated(trade: FeeFill): number {
  if (trade.swapFeeUsd != null && Number.isFinite(trade.swapFeeUsd)) return trade.swapFeeUsd;
  return swapFeeUsd(trade.mint, trade.symbol, trade.qty * trade.price, trade.leverage);
}

/** Swap fee for the round trip, and the usage fee when the close made money. */
export function resultFees(close: FeeFill & Pick<Trade, "pnlUsd">, trades: FeeFill[]): ResultFees {
  const closeFee = stampedOrEstimated(close);
  const open = openTradeFor(close, trades);
  let openFee = closeFee;
  if (open) {
    const full = stampedOrEstimated(open);
    const fraction = open.qty > 0 ? Math.min(1, close.qty / open.qty) : 1;
    openFee = full * fraction;
  }
  const swapUsd = Math.round((openFee + closeFee) * 1e6) / 1e6;
  return { swapUsd, usageUsd: usageFeeUsd(close.pnlUsd) };
}

/** A fee small enough that two cents of rounding would hide it. */
export function formatFee(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

/** Remaining time until a limit lifts, ticking down to the second. */
export function formatRemain(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  return `${minutes}m ${pad(seconds)}s`;
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

function symbolOnLine(line: string): string | null {
  const match = line.match(/^([A-Za-z0-9.]+)(?:\s+(?:long|short))?:/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function cooldownResumeMs(line: string, trades: Trade[], minutes: number): number | undefined {
  if (!/cooldown after/i.test(line) || !(minutes > 0)) return undefined;
  const symbol = symbolOnLine(line);
  const last = trades.find((trade) => {
    if (trade.action !== "close") return false;
    if (trade.reason !== "stop" && trade.reason !== "time" && trade.reason !== "risk-off") return false;
    if (symbol && trade.symbol.toUpperCase() !== symbol) return false;
    return true;
  });
  const at = last ? Date.parse(last.at) : NaN;
  if (!Number.isFinite(at)) return undefined;
  return at + minutes * 60_000;
}

function limitResumeAt(
  line: string,
  input: { trades: Trade[]; config: BotConfig; quietUntil?: string | null },
  now: number,
): number | undefined {
  if (/day budget/i.test(line)) return nextSessionMs(now);
  if (/no new trade after that fill/i.test(line) && input.quietUntil) {
    const at = Date.parse(input.quietUntil);
    if (Number.isFinite(at)) return at;
  }
  const minutes = ruleOn(input.config, "cooldown") ? Math.max(0, input.config.cooldownMinutes || 0) : 0;
  return cooldownResumeMs(line, input.trades, minutes);
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
  /** After a preset stop or target, no new ticket until this time. */
  quietUntil?: string | null;
}): BotActivity {
  const now = input.nowMs ?? Date.now();
  const targets: ActivityItem[] = [];
  const limits: ActivityItem[] = [];
  const walls: ActivityItem[] = [];
  const seen = new Set<string>();
  const add = (list: ActivityItem[], kind: ActivityKind, text: string, resumeAt?: number) => {
    const key = `${kind}:${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    const item: ActivityItem = { kind, text };
    if (resumeAt != null && Number.isFinite(resumeAt) && resumeAt > now) item.resumeAt = resumeAt;
    list.push(item);
  };

  if (input.killSwitch) add(limits, "limit", "Emergency stop is on, so no new trades are sent.");
  if (input.running && dayLossBreached(input.portfolio, input.config)) {
    add(
      limits,
      "limit",
      `Today's loss hit the ${input.config.dailyLossLimitPct}% limit, so no new trades until tomorrow.`,
      nextSessionMs(now),
    );
  }
  if (
    input.running &&
    ruleOn(input.config, "maxPositions") &&
    input.config.maxPositions > 0 &&
    input.positions.length >= input.config.maxPositions
  ) {
    add(
      limits,
      "limit",
      `Holding ${input.positions.length} coins, the most allowed at once, so no new coin until one sells.`,
    );
  }
  const streakCap = ruleOn(input.config, "lossStreak") ? input.config.lossStreakPause : 0;
  const streakResume = input.running ? lossStreakResumeAt(input.trades, streakCap, now) : null;
  if (streakResume != null) {
    add(
      limits,
      "limit",
      `Resting for an hour after ${input.config.lossStreakPause} losses in a row. No new trades until that hour ends.`,
      streakResume,
    );
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
      add(limits, "limit", core, limitResumeAt(line, input, now));
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
