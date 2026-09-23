"use client";

import { configureBot, controlBot, loadDesk } from "@/lib/client";
import type { BotConfig, DeskPayload, ResearchThesis } from "@/lib/types";
import { pct, priceFmt, usd } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Label, Money, Pill, Px, ScoreRing, Spark, Stat, Tone } from "./bits";

type Tab = "overview" | "radar" | "bot" | "book" | "risk";

const NAV: { id: Tab; label: string; kicker: string }[] = [
  { id: "overview", label: "Overview", kicker: "01" },
  { id: "radar", label: "Radar", kicker: "02" },
  { id: "bot", label: "Bot", kicker: "03" },
  { id: "book", label: "Book", kicker: "04" },
  { id: "risk", label: "Risk", kicker: "05" },
];

export function DeskApp() {
  const [tab, setTab] = useState<Tab>("overview");
  const [desk, setDesk] = useState<DeskPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);
  const [thesis, setThesis] = useState<ResearchThesis | null>(null);
  const [clock, setClock] = useState("");

  const applyDesk = useCallback((next: DeskPayload) => {
    setDesk(next);
    setError(null);
    setThesis((cur) => (cur ? next.research.find((r) => r.id === cur.id) ?? cur : null));
  }, []);

  const refresh = useCallback(async () => {
    try {
      applyDesk(await loadDesk());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Desk refresh failed");
    } finally {
      setBooting(false);
    }
  }, [applyDesk]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!desk?.bot.running) return;
    const seconds = Math.max(6, desk.config.scanSeconds);
    const id = setInterval(async () => {
      try {
        applyDesk(await controlBot("tick"));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Tick failed");
      }
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [applyDesk, desk?.bot.running, desk?.config.scanSeconds]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      void control(desk?.bot.running ? "stop" : "start");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk?.bot.running]);

  const control = async (action: "start" | "stop" | "reset" | "tick") => {
    setBusy(true);
    try {
      applyDesk(await controlBot(action));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Control failed");
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = async (config: Partial<BotConfig>) => {
    setBusy(true);
    try {
      applyDesk(await configureBot(config));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Config failed");
    } finally {
      setBusy(false);
    }
  };

  const winRate = useMemo(() => {
    if (!desk) return 0;
    const t = desk.portfolio.winCount + desk.portfolio.lossCount;
    return t ? (desk.portfolio.winCount / t) * 100 : 0;
  }, [desk]);

  if (booting && !desk) {
    return (
      <div className="grid min-h-screen place-items-center px-6">
        <div className="boot-fade text-center">
          <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--crimson)]">T-800 // Solana</div>
          <h1 className="mt-3 text-4xl font-medium">Arming the desk</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">Pulling BTC/ETH/SOL, Solana TVL, DEX tape, and 5m structure.</p>
        </div>
      </div>
    );
  }

  if (!desk) {
    return (
      <div className="grid min-h-screen place-items-center px-6">
        <div className="glass max-w-md rounded-3xl p-6">
          <div className="text-[var(--crimson)]">Desk offline</div>
          <p className="mt-2 text-sm text-[var(--muted)]">{error || "No market payload."}</p>
          <button className="mt-4 rounded-full bg-white px-4 py-2 text-sm text-black" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[rgba(7,8,12,0.78)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-[rgba(255,59,74,0.12)] text-sm font-semibold text-[var(--crimson)]">
              T8
            </div>
            <div>
              <div className="text-sm font-medium">T-800 Trader</div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--faint)]">Solana desk</div>
            </div>
          </div>
          <div className="hidden items-center gap-5 md:flex">
            <Ticker label="SOL" value={priceFmt(desk.regime.sol.price)} chg={desk.regime.sol.change24h} />
            <Ticker label="BTC" value={priceFmt(desk.regime.btc.price)} chg={desk.regime.btc.change24h} />
            <Ticker label="ETH" value={priceFmt(desk.regime.eth.price)} chg={desk.regime.eth.change24h} />
            {desk.regime.fearGreed ? (
              <Ticker label="F&G" value={`${desk.regime.fearGreed.value}`} hint={desk.regime.fearGreed.label} />
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Pill tone="amber">Paper</Pill>
            <Pill tone={desk.bot.running ? "mint" : "default"}>
              <span className={`pulse-dot ${desk.bot.running ? "bg-[var(--mint)] text-[var(--mint)]" : "bg-[var(--faint)] text-[var(--faint)]"}`} />
              {desk.bot.running ? "Armed" : "Standby"}
            </Pill>
            <div className="hidden text-right sm:block">
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">Equity</div>
              <div className="num">{usd(desk.portfolio.equityUsd)}</div>
            </div>
            <div className="num hidden text-[var(--muted)] lg:block">{clock}</div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-5 px-4 py-5 lg:grid-cols-[220px_1fr]">
        <aside className="glass hairline h-fit rounded-3xl p-3 lg:sticky lg:top-20">
          {NAV.map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              onClick={() => {
                setTab(item.id);
                setThesis(null);
                window.scrollTo({ top: 0, behavior: "auto" });
              }}
              className={`mb-1 flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left ${
                tab === item.id ? "bg-[rgba(255,255,255,0.06)]" : "hover:bg-[rgba(255,255,255,0.03)]"
              }`}
            >
              <span>
                <span className="mr-2 text-[11px] text-[var(--faint)]">{item.kicker}</span>
                {item.label}
              </span>
              {item.id === "bot" && desk.bot.running ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--mint)]" /> : null}
            </button>
          ))}
          <button
            disabled={busy}
            onClick={() => void control(desk.bot.running ? "stop" : "start")}
            className={`mt-3 w-full rounded-2xl px-3 py-3 text-sm font-medium ${
              desk.bot.running ? "bg-[rgba(255,59,74,0.14)] text-[var(--crimson)]" : "bg-[var(--mint)] text-[#062016]"
            }`}
          >
            {desk.bot.running ? "Disarm bot" : "Arm bot"}
          </button>
          <p className="mt-3 px-2 text-[11px] leading-5 text-[var(--faint)]">
            Spacebar arms or disarms. Paper fills only. Not financial advice.
          </p>
        </aside>

        <main className="min-w-0 space-y-5 pt-1">
          {error ? (
            <div className="rounded-2xl border border-[rgba(255,59,74,0.3)] bg-[rgba(255,59,74,0.08)] px-4 py-3 text-sm text-[var(--crimson)]">
              {error}
            </div>
          ) : null}

          {tab === "overview" ? (
            <Overview desk={desk} winRate={winRate} onOpen={setThesis} onArm={() => void control("start")} />
          ) : null}
          {tab === "radar" ? <Radar desk={desk} onOpen={setThesis} /> : null}
          {tab === "bot" ? (
            <BotView desk={desk} busy={busy} onControl={control} onOpen={setThesis} />
          ) : null}
          {tab === "book" ? <Book desk={desk} winRate={winRate} /> : null}
          {tab === "risk" ? <RiskView desk={desk} busy={busy} onSave={saveConfig} onReset={() => void control("reset")} /> : null}
        </main>
      </div>

      {thesis ? <ThesisDrawer thesis={thesis} onClose={() => setThesis(null)} /> : null}
    </div>
  );
}

function Ticker({ label, value, chg, hint }: { label: string; value: string; chg?: number; hint?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="num text-sm">{value}</span>
        {chg !== undefined ? <Tone value={chg} /> : <span className="text-xs text-[var(--muted)]">{hint}</span>}
      </div>
    </div>
  );
}

function Overview({
  desk,
  winRate,
  onOpen,
  onArm,
}: {
  desk: DeskPayload;
  winRate: number;
  onOpen: (t: ResearchThesis) => void;
  onArm: () => void;
}) {
  const stanceTone = desk.regime.stance === "risk-on" ? "mint" : desk.regime.stance === "defensive" ? "crimson" : "amber";
  return (
    <div className="space-y-5 boot-fade">
      <section className="glass hairline scan rounded-3xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Pill tone={stanceTone}>{desk.regime.stance.replace("-", " ")}</Pill>
            <h1 className="mt-3 max-w-3xl text-3xl font-medium tracking-tight md:text-4xl">
              Solana first. Research first. Then a fast paper trade — or nothing.
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">{desk.regime.overview}</p>
          </div>
          <button onClick={onArm} className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black">
            Arm the bot
          </button>
        </div>
        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <div>
            <Label>Crowded</Label>
            <ul className="space-y-2 text-sm text-[var(--muted)]">
              {desk.regime.crowded.map((c) => (
                <li key={c}>— {c}</li>
              ))}
            </ul>
          </div>
          <div>
            <Label>Overlooked</Label>
            <ul className="space-y-2 text-sm text-[var(--muted)]">
              {desk.regime.overlooked.map((c) => (
                <li key={c}>— {c}</li>
              ))}
            </ul>
          </div>
          <div>
            <Label>Narratives</Label>
            <div className="flex flex-wrap gap-2">
              {desk.regime.narratives.map((n) => (
                <Pill key={n} tone="ice">
                  {n}
                </Pill>
              ))}
            </div>
            <div className="mt-4 text-xs text-[var(--faint)]">
              Universe {desk.universeSize} · screened out {desk.eliminated} · scored {desk.candidatesScanned}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <Stat label="Paper equity" value={usd(desk.portfolio.equityUsd)} sub={`Cash ${usd(desk.portfolio.cashUsd)}`} />
        <Stat
          label="Session P&L"
          value={<Tone value={desk.portfolio.dayPnlUsd}>{usd(desk.portfolio.dayPnlUsd)}</Tone>}
          sub={`Realized ${usd(desk.portfolio.realizedPnlUsd)}`}
          tone={desk.portfolio.dayPnlUsd >= 0 ? "mint" : "crimson"}
        />
        <Stat label="Open risk" value={`${desk.positions.length}/${desk.config.maxPositions}`} sub={`Unreal ${usd(desk.portfolio.unrealizedPnlUsd)}`} />
        <Stat label="Win rate" value={`${winRate.toFixed(0)}%`} sub={`${desk.portfolio.tradeCount} tickets`} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="glass hairline rounded-3xl p-5">
          <div className="flex items-center justify-between">
            <Label>Asymmetric radar</Label>
            <span className="text-xs text-[var(--faint)]">Click a name for the full thesis</span>
          </div>
          <div className="space-y-2">
            {desk.research.map((r) => (
              <button
                key={r.id}
                onClick={() => onOpen(r)}
                className="flex w-full items-center gap-4 rounded-2xl border border-[var(--line)] px-3 py-3 text-left hover:bg-[rgba(255,255,255,0.03)]"
              >
                <ScoreRing score={r.researchScore} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.ticker}</span>
                    <Pill>{r.sector}</Pill>
                    <Tone value={r.candidate.flows.h24.priceChangePct} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-[var(--muted)]">{r.coreThesis}</p>
                </div>
                <div className="hidden text-right sm:block">
                  <Px n={r.price} />
                  <div className="text-xs text-[var(--faint)]">{usd(r.marketCap)}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div className="glass hairline rounded-3xl p-5">
            <Label>Live tape</Label>
            {desk.signals.length === 0 && desk.positions.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No signal yet. Arm the bot and it will only fire when structure and liquidity agree.</p>
            ) : (
              <div className="space-y-3">
                {desk.positions.slice(0, 4).map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span>
                      {p.symbol} <Pill tone={p.side === "long" ? "mint" : "crimson"}>{p.side}</Pill>
                    </span>
                    <Tone value={((p.markPrice - p.entryPrice) / p.entryPrice) * 100 * (p.side === "long" ? 1 : -1)} />
                  </div>
                ))}
                {desk.signals.slice(0, 4).map((s) => (
                  <div key={s.id} className="text-sm text-[var(--muted)]">
                    <span className="text-[var(--text)]">{s.symbol}</span> {s.side} · {s.reason} · {s.confidence.toFixed(0)} conf
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="glass hairline rounded-3xl p-5">
            <Label>What could I be wrong about?</Label>
            <ul className="space-y-2 text-sm leading-6 text-[var(--muted)]">
              {desk.whatCouldBeWrong.slice(0, 4).map((w) => (
                <li key={w}>— {w}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}

function Radar({ desk, onOpen }: { desk: DeskPayload; onOpen: (t: ResearchThesis) => void }) {
  return (
    <div className="space-y-4 boot-fade">
      <div>
        <h2 className="text-2xl font-medium tracking-tight">Research radar</h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--muted)]">
          Broad Solana universe, weak names eliminated, then only the strongest finalists. Scores use live pool tape, not social
          heat. Missing unlocks, revenue, and holder data are labeled — never invented.
        </p>
      </div>
      <div className="glass hairline desk-scroll overflow-x-auto rounded-3xl p-1">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
            <tr>
              <th className="px-4 py-3">Asset</th>
              <th>Ticker</th>
              <th>Price</th>
              <th>Market cap</th>
              <th>FDV</th>
              <th>Sector</th>
              <th>Core thesis</th>
              <th>Key catalyst</th>
              <th>Biggest risk</th>
              <th>Key metric</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {desk.research.map((r) => (
              <tr
                key={r.id}
                onClick={() => onOpen(r)}
                className="cursor-pointer border-t border-[var(--line)] hover:bg-[rgba(255,255,255,0.04)]"
              >
                <td className="px-4 py-3 font-medium">{r.asset}</td>
                <td className="num">{r.ticker}</td>
                <td className="num">{priceFmt(r.price)}</td>
                <td className="num">{usd(r.marketCap)}</td>
                <td className="num">{usd(r.fdv)}</td>
                <td>{r.sector}</td>
                <td className="max-w-[260px] truncate text-[var(--muted)]">{r.coreThesis}</td>
                <td className="max-w-[160px] truncate">{r.keyCatalyst}</td>
                <td className="max-w-[160px] truncate text-[var(--crimson)]">{r.biggestRisk}</td>
                <td className="num">{r.keyMetric}</td>
                <td className="num text-[var(--amber)]">{r.researchScore.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BotView({
  desk,
  busy,
  onControl,
  onOpen,
}: {
  desk: DeskPayload;
  busy: boolean;
  onControl: (a: "start" | "stop" | "reset" | "tick") => void;
  onOpen: (t: ResearchThesis) => void;
}) {
  return (
    <div className="space-y-4 boot-fade">
      <section className="glass hairline rounded-3xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Pill tone={desk.bot.running ? "mint" : "default"}>{desk.bot.running ? "Scanning Solana" : "Idle"}</Pill>
            <h2 className="mt-3 text-3xl font-medium">Calculated shorts and longs. Time-boxed.</h2>
            <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
              The bot only trades names that survive the research screen. Entries come from 5-minute structure: breakout, RSI
              reclaim, or climax fade. Stops, targets, and a 50-minute time stop are mandatory.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => onControl(desk.bot.running ? "stop" : "start")}
              className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black"
            >
              {desk.bot.running ? "Disarm" : "Arm"}
            </button>
            <button
              disabled={busy}
              onClick={() => onControl("tick")}
              className="rounded-full border border-[var(--line-2)] px-5 py-2.5 text-sm"
            >
              Force tick
            </button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <Stat label="Ticks" value={desk.bot.ticks} sub={desk.bot.lastTickAt ? new Date(desk.bot.lastTickAt).toLocaleTimeString() : "—"} />
          <Stat label="Last error" value={desk.bot.lastError ? "Yes" : "None"} sub={desk.bot.lastError ?? "Clean"} tone={desk.bot.lastError ? "crimson" : "mint"} />
          <Stat label="Max risk / trade" value={`${desk.config.maxRiskPerTradePct}%`} />
          <Stat label="Daily loss cap" value={`${desk.config.dailyLossLimitPct}%`} />
        </div>
      </section>
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="glass hairline rounded-3xl p-5">
          <Label>Signals this cycle</Label>
          {desk.signals.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Waiting for confluence. Silence is a position.</p>
          ) : (
            <div className="space-y-3">
              {desk.signals.map((s) => (
                <div key={s.id} className="rounded-2xl border border-[var(--line)] p-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">
                      {s.symbol} <Pill tone={s.side === "long" ? "mint" : "crimson"}>{s.side}</Pill>
                    </div>
                    <span className="num text-[var(--amber)]">{s.confidence.toFixed(0)}</span>
                  </div>
                  <p className="mt-2 text-sm text-[var(--muted)]">{s.thesis}</p>
                  <div className="mt-2 text-xs text-[var(--faint)]">
                    Stop {s.stopPct.toFixed(2)}% · Target {s.targetPct.toFixed(2)}% · {s.reason}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="glass hairline rounded-3xl p-5">
          <Label>Research bench</Label>
          <div className="space-y-2">
            {desk.research.map((r) => (
              <button key={r.id} onClick={() => onOpen(r)} className="flex w-full items-center justify-between rounded-2xl px-2 py-2 hover:bg-[rgba(255,255,255,0.03)]">
                <span>
                  {r.ticker} <span className="text-[var(--muted)]">{r.sector}</span>
                </span>
                <span className="num text-[var(--amber)]">{r.researchScore.toFixed(1)}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Book({ desk, winRate }: { desk: DeskPayload; winRate: number }) {
  const curve = desk.equityCurve.map((p) => p.equity);
  return (
    <div className="space-y-4 boot-fade">
      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="Equity" value={usd(desk.portfolio.equityUsd)} sub={<Spark values={curve} />} />
        <Stat label="Realized" value={<Tone value={desk.portfolio.realizedPnlUsd}>{usd(desk.portfolio.realizedPnlUsd)}</Tone>} />
        <Stat label="Hit rate" value={`${winRate.toFixed(0)}%`} sub={`${desk.portfolio.winCount}W / ${desk.portfolio.lossCount}L`} />
      </div>
      <div className="glass hairline overflow-x-auto rounded-3xl">
        <div className="px-4 pt-4">
          <Label>Open positions</Label>
        </div>
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">
            <tr>
              <th className="px-4 py-2">Symbol</th>
              <th>Side</th>
              <th>Entry</th>
              <th>Mark</th>
              <th>Stop</th>
              <th>Target</th>
              <th>Notional</th>
              <th>P&L</th>
            </tr>
          </thead>
          <tbody>
            {desk.positions.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-[var(--muted)]" colSpan={8}>
                  Flat. The book is waiting for a clean setup.
                </td>
              </tr>
            ) : (
              desk.positions.map((p) => {
                const pnlPct = ((p.markPrice - p.entryPrice) / p.entryPrice) * 100 * (p.side === "long" ? 1 : -1);
                return (
                  <tr key={p.id} className="border-t border-[var(--line)]">
                    <td className="px-4 py-3 font-medium">{p.symbol}</td>
                    <td>{p.side}</td>
                    <td className="num">{priceFmt(p.entryPrice)}</td>
                    <td className="num">{priceFmt(p.markPrice)}</td>
                    <td className="num">{priceFmt(p.stopPrice)}</td>
                    <td className="num">{priceFmt(p.targetPrice)}</td>
                    <td className="num">{usd(p.notional)}</td>
                    <td>
                      <Tone value={pnlPct} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="glass hairline overflow-x-auto rounded-3xl">
        <div className="px-4 pt-4">
          <Label>Tickets</Label>
        </div>
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">
            <tr>
              <th className="px-4 py-2">Time</th>
              <th>Sym</th>
              <th>Action</th>
              <th>Side</th>
              <th>Price</th>
              <th>P&L</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {desk.trades.slice(0, 40).map((t) => (
              <tr key={t.id} className="border-t border-[var(--line)]">
                <td className="px-4 py-3 num text-[var(--muted)]">{new Date(t.at).toLocaleTimeString()}</td>
                <td>{t.symbol}</td>
                <td>{t.action}</td>
                <td>{t.side}</td>
                <td className="num">{priceFmt(t.price)}</td>
                <td>{t.pnlUsd === null ? "—" : <Tone value={t.pnlUsd}>{usd(t.pnlUsd)}</Tone>}</td>
                <td className="text-[var(--muted)]">{t.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RiskView({
  desk,
  busy,
  onSave,
  onReset,
}: {
  desk: DeskPayload;
  busy: boolean;
  onSave: (c: Partial<BotConfig>) => void;
  onReset: () => void;
}) {
  const [local, setLocal] = useState(desk.config);
  useEffect(() => setLocal(desk.config), [desk.config]);

  return (
    <div className="space-y-4 boot-fade">
      <div className="glass hairline rounded-3xl p-6">
        <h2 className="text-2xl font-medium">Risk is the product</h2>
        <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
          Default book is $10,000 paper USDC. The bot refuses a fifth position, refuses a second ticket in the same mint, and
          goes flat-risk when the daily loss cap is hit.
        </p>
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <Slider
            label="Risk per trade"
            suffix="%"
            min={0.3}
            max={2.5}
            step={0.1}
            value={local.maxRiskPerTradePct}
            onChange={(v) => setLocal({ ...local, maxRiskPerTradePct: v })}
          />
          <Slider
            label="Daily loss limit"
            suffix="%"
            min={2}
            max={12}
            step={0.5}
            value={local.dailyLossLimitPct}
            onChange={(v) => setLocal({ ...local, dailyLossLimitPct: v })}
          />
          <Slider
            label="Max positions"
            min={1}
            max={6}
            step={1}
            value={local.maxPositions}
            onChange={(v) => setLocal({ ...local, maxPositions: v })}
          />
          <Slider
            label="Min liquidity"
            suffix="k"
            min={50}
            max={500}
            step={10}
            value={local.minLiquidityUsd / 1000}
            onChange={(v) => setLocal({ ...local, minLiquidityUsd: v * 1000 })}
          />
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={local.allowShorts}
              onChange={(e) => setLocal({ ...local, allowShorts: e.target.checked })}
            />
            Allow paper shorts
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={local.allowMemes}
              onChange={(e) => setLocal({ ...local, allowMemes: e.target.checked })}
            />
            Allow screened memes
          </label>
        </div>
        <div className="mt-6 flex gap-2">
          <button disabled={busy} onClick={() => onSave(local)} className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black">
            Save policy
          </button>
          <button disabled={busy} onClick={onReset} className="rounded-full border border-[var(--line-2)] px-5 py-2.5 text-sm">
            Reset paper book
          </button>
        </div>
      </div>
      <div className="glass hairline rounded-3xl p-6">
        <Label>What could I be wrong about?</Label>
        <ul className="space-y-2 text-sm leading-6 text-[var(--muted)]">
          {desk.whatCouldBeWrong.map((w) => (
            <li key={w}>— {w}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-2 flex justify-between text-sm">
        <span>{label}</span>
        <span className="num text-[var(--amber)]">
          {value}
          {suffix ?? ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--amber)]"
      />
    </label>
  );
}

function ThesisDrawer({ thesis, onClose }: { thesis: ResearchThesis; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <aside
        className="desk-scroll h-full w-full max-w-xl overflow-y-auto border-l border-[var(--line)] bg-[#0b0d13] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <Pill>{thesis.sector}</Pill>
            <h3 className="mt-3 text-3xl font-medium">
              {thesis.asset} <span className="text-[var(--muted)]">{thesis.ticker}</span>
            </h3>
            <div className="mt-2 flex gap-4 text-sm text-[var(--muted)]">
              <span>
                <Px n={thesis.price} />
              </span>
              <span>MC <Money n={thesis.marketCap} /></span>
              <span>FDV <Money n={thesis.fdv} /></span>
            </div>
          </div>
          <div className="text-right">
            <ScoreRing score={thesis.researchScore} />
            <button onClick={onClose} className="mt-3 text-sm text-[var(--muted)]">
              Close
            </button>
          </div>
        </div>
        <Block title="Core thesis" body={thesis.coreThesis} />
        <Block title="Why it may be mispriced" body={thesis.whyMispriced} />
        <List title="Fundamental evidence" items={thesis.fundamentalEvidence} />
        <List title="On-chain / tape evidence" items={thesis.onchainEvidence} />
        <Block title="Tokenomics" body={thesis.tokenomics} />
        <Block title="Relative valuation" body={thesis.relativeValuation} />
        <Block title="Competitive positioning" body={thesis.competitivePositioning} />
        <div className="mt-5">
          <Label>Catalysts</Label>
          <div className="space-y-2">
            {thesis.catalysts.map((c) => (
              <div key={c.title} className="rounded-2xl border border-[var(--line)] p-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{c.title}</span>
                  <Pill tone={c.status === "confirmed" ? "mint" : "amber"}>{c.status}</Pill>
                  <span className="text-[var(--faint)]">{c.window}</span>
                </div>
                <p className="mt-1 text-sm text-[var(--muted)]">{c.detail}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-5 grid gap-3">
          <Block title="Bull" body={thesis.bullCase} />
          <Block title="Base" body={thesis.baseCase} />
          <Block title="Bear" body={thesis.bearCase} />
        </div>
        <List title="Thesis invalidation" items={thesis.invalidation} />
        <List title="Monitor" items={thesis.monitor} />
        <List title="Missing data (not invented)" items={thesis.missingData} />
        <List title="Sources" items={thesis.sources} />
        <div className="mt-6 text-xs text-[var(--faint)]">
          24h {pct(thesis.candidate.flows.h24.priceChangePct)} · Liq {usd(thesis.candidate.liquidityUsd)} · Vol{" "}
          {usd(thesis.candidate.volume24hUsd)}
        </div>
      </aside>
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-5">
      <Label>{title}</Label>
      <p className="text-sm leading-6 text-[var(--muted)]">{body}</p>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-5">
      <Label>{title}</Label>
      <ul className="space-y-1.5 text-sm leading-6 text-[var(--muted)]">
        {items.map((i) => (
          <li key={i}>— {i}</li>
        ))}
      </ul>
    </div>
  );
}
