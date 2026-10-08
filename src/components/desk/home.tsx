"use client";

import type { ChainId } from "@/lib/chain";
import { botActivity, exitWords, homeResults, homeStatus, planRules, progressToGoal, visibleActivity, type ActivityItem } from "@/lib/home";
import type { DeskPayload, Position } from "@/lib/types";
import { pct, priceFmt, usd } from "@/lib/utils";
import { Pill } from "./bits";

const pageStartedAt = Date.now();

function openPnl(position: Position): { usd: number; pct: number } {
  const dir = position.side === "long" ? 1 : -1;
  const move = position.entryPrice > 0 ? ((position.markPrice - position.entryPrice) / position.entryPrice) * 100 * dir : 0;
  return { usd: position.qty * position.entryPrice * (move / 100), pct: move };
}

function toneClass(n: number): string {
  return n > 0 ? "pos" : n < 0 ? "neg" : "text-[var(--muted)]";
}

export function Home({
  desk,
  chain = "solana",
  balanceUsd,
  busy,
  closingId,
  closeError,
  onStartStop,
  onMode,
  onClose,
  onOpenPosition,
  onMore,
}: {
  desk: DeskPayload;
  chain?: ChainId;
  balanceUsd: number;
  busy: boolean;
  closingId: string | null;
  closeError: { id: string; message: string } | null;
  onStartStop: () => void;
  onMode: (real: boolean) => void;
  onClose: (id: string) => void;
  onOpenPosition: (id: string) => void;
  onMore: () => void;
}) {
  const real = desk.config.walletSwaps;
  const positions = real ? desk.positions.filter((p) => p.signature || (p.leverage ?? 1) > 1) : desk.positions;
  const trades = real ? desk.trades.filter((t) => t.signature) : desk.trades;
  const status = homeStatus(desk.bot, desk.config, positions.length);
  const running = desk.bot.running;
  const activity = botActivity({
    running,
    killSwitch: desk.config.killSwitch,
    lastError: desk.bot.lastError,
    lastTickAt: desk.bot.lastTickAt,
    ticks: desk.bot.ticks,
    blocked: desk.bot.blocked,
    scanSeconds: desk.config.scanSeconds,
    positions,
    trades,
    portfolio: desk.portfolio,
    config: desk.config,
    pageStartedAt: pageStartedAt,
  });
  const statusNow = visibleActivity(activity);
  const results = homeResults(trades);
  const today = desk.portfolio.dayPnlUsd;
  const recent = trades.filter((t) => t.action === "close").slice(0, 5);
  const dot =
    status.tone === "mint" ? "bg-[var(--mint)]" : status.tone === "crimson" ? "bg-[var(--crimson)]" : status.tone === "amber" ? "bg-[var(--amber)]" : "bg-[var(--faint)]";

  return (
    <div className="space-y-3">
      <section className="neon p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="radiogroup" aria-label="Money mode" className="inline-flex rounded-full border border-[var(--line)] p-1 text-sm">
            <button
              type="button"
              role="radio"
              aria-checked={!real}
              disabled={busy}
              onClick={() => real && onMode(false)}
              className={`rounded-full px-4 py-1.5 ${!real ? "bg-[var(--accent-soft)] text-[var(--magenta)]" : "text-[var(--muted)]"}`}
            >
              Practice
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={real}
              disabled={busy}
              onClick={() => !real && onMode(true)}
              className={`rounded-full px-4 py-1.5 ${real ? "bg-[var(--danger-soft)] text-[var(--crimson)]" : "text-[var(--muted)]"}`}
            >
              Real money
            </button>
          </div>
          <Pill tone={real ? "crimson" : "mint"}>{real ? "Real money" : "Pretend money"}</Pill>
        </div>

        <div className="mt-6 flex items-start gap-3">
          <span className={`mt-3 h-3 w-3 shrink-0 rounded-full ${dot} ${running ? "pulse-dot" : ""}`} />
          <div className="min-w-0">
            <h2 className="text-3xl font-medium tracking-tight sm:text-4xl">{status.title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{status.detail}</p>
          </div>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={onStartStop}
          className={`btn mt-6 w-full py-4 text-lg ${running ? "bg-[var(--danger-soft)] text-[var(--crimson)]" : "btn-magenta"}`}
        >
          {busy ? "Working…" : running ? "Stop the bot" : real ? "Start trading real money" : "Start practicing"}
        </button>
        {running && real ? (
          <p className="mt-2 text-center text-xs text-[var(--faint)]">Stopping sells what the bot holds and sends the money back to your wallet.</p>
        ) : null}

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label={real ? "Trading balance" : "Practice balance"} value={usd(balanceUsd)} />
          <Figure label="Today" value={usd(today)} tone={today} />
          <Figure label="All closed trades" value={usd(results.netUsd)} tone={results.netUsd} />
          <Figure
            label="Wins"
            value={results.closed ? `${results.wins} of ${results.closed}` : "None yet"}
          />
        </div>
      </section>

      <section className="neon p-5 sm:p-6" aria-label="What the bot is doing">
        <h3 className="text-lg font-medium">What the bot is doing</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{activity.summary}</p>
        {statusNow.length ? (
          <div className={`mt-4 grid gap-3 ${statusNow.length > 1 ? "lg:grid-cols-2" : ""}`}>
            {statusNow.map((group) => (
              <ActivityList key={group.kind} title={group.title} tone={group.kind === "target" ? "mint" : group.kind === "limit" ? "amber" : "crimson"} items={group.items} />
            ))}
          </div>
        ) : null}
      </section>

      <section className="neon p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-medium">Open trades</h3>
          <span className="text-xs text-[var(--faint)]">{positions.length ? `${positions.length} open` : ""}</span>
        </div>
        {positions.length ? (
          <ul className="mt-4 space-y-3">
            {positions.map((p) => {
              const pnl = openPnl(p);
              const progress = progressToGoal(p);
              return (
                <li key={p.id} className="rounded-2xl border border-[var(--line)] bg-black/20 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <button type="button" onClick={() => onOpenPosition(p.id)} className="text-left">
                      <span className="text-lg font-medium">{p.symbol}</span>
                      <span className="ml-2 text-xs text-[var(--faint)]">
                        {p.side === "long" ? "betting it rises" : "betting it falls"}
                        {(p.leverage ?? 1) > 1 ? ` · ${p.leverage}x` : ""}
                      </span>
                    </button>
                    <span className={`num text-lg ${toneClass(pnl.usd)}`}>
                      {usd(pnl.usd)} <span className="text-sm">({pct(pnl.pct)})</span>
                    </span>
                  </div>
                  <div className="mt-3">
                    <div className="relative h-2 overflow-hidden rounded-full bg-[var(--chart-grid)]">
                      <span
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${progress}%`, background: pnl.usd >= 0 ? "var(--mint)" : "var(--crimson)" }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] text-[var(--faint)]">
                      <span>Safety stop {priceFmt(p.stopPrice)}</span>
                      <span>Now {priceFmt(p.markPrice)}</span>
                      <span>Goal {priceFmt(p.targetPrice)}</span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-[var(--muted)]">Bought at {priceFmt(p.entryPrice)}</span>
                    <button
                      type="button"
                      disabled={closingId === p.id}
                      onClick={() => onClose(p.id)}
                      className="btn btn-ghost px-4 py-1.5 text-sm"
                    >
                      {closingId === p.id ? "Selling…" : "Sell now"}
                    </button>
                  </div>
                  {closeError?.id === p.id ? <p className="mt-2 text-xs text-[var(--crimson)]">{closeError.message}</p> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            Nothing open. {running ? "The bot buys when a setup appears." : "Start the bot and it buys when a setup appears."}
          </p>
        )}
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="neon p-5 sm:p-6">
          <h3 className="text-lg font-medium">Recent results</h3>
          {recent.length ? (
            <ul className="mt-3 divide-y divide-[var(--line)]">
              {recent.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{t.symbol}</span>
                    <span className="ml-2 text-[var(--muted)]">{exitWords(t.reason)}</span>
                  </span>
                  <span className={`num shrink-0 ${toneClass(t.pnlUsd ?? 0)}`}>{usd(t.pnlUsd)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-[var(--muted)]">No finished trades yet.</p>
          )}
        </section>

        <section className="neon p-5 sm:p-6">
          <h3 className="text-lg font-medium">How the bot trades</h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--muted)]">
            {planRules(desk.config, chain).map((rule) => (
              <li key={rule} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--magenta)]" />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-5 text-[var(--faint)]">
            {chain === "cronos"
              ? "No bot can promise a profit. These Cronos rules have not been replayed. Practice first, and only use money you can afford to lose."
              : "No bot can promise a profit. In 120-day replays with fees these rules stayed close to flat. Practice first, and only use money you can afford to lose."}
          </p>
          <button type="button" onClick={onMore} className="mt-3 text-sm text-[var(--magenta)] underline-offset-4 hover:underline">
            Change settings
          </button>
        </section>
      </div>
    </div>
  );
}

function ActivityList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "mint" | "amber" | "crimson";
  items: ActivityItem[];
}) {
  const dot = tone === "mint" ? "bg-[var(--mint)]" : tone === "amber" ? "bg-[var(--amber)]" : "bg-[var(--crimson)]";
  const titleColor = tone === "mint" ? "text-[var(--mint)]" : tone === "amber" ? "text-[var(--amber)]" : "text-[var(--crimson)]";
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-black/20 p-4">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <h4 className={`text-sm font-medium ${titleColor}`}>{title}</h4>
      </div>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--muted)]">
        {items.map((item) => (
          <li key={item.text}>{item.text}</li>
        ))}
      </ul>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div className="stat-card neon hairline p-3">
      <div className="text-[11px] tracking-wide text-[var(--faint)]">{label}</div>
      <div className={`mt-1 break-words text-xl num ${tone === undefined ? "" : toneClass(tone)}`}>{value}</div>
    </div>
  );
}
