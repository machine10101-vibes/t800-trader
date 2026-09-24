"use client";

import { buildMonitor, type MonitorView } from "@/lib/monitor";
import { peekBook } from "@/lib/store";
import { readBalances } from "@/lib/solana/wallet";
import { pct, shortAddress, usd } from "@/lib/utils";
import { rMultiple } from "@/lib/trading/risk";
import { useEffect, useState } from "react";
import { Label, Pill, Spark, Stat, Tone } from "./bits";

export function WatchScreen({ address, onClose }: { address: string; onClose: () => void }) {
  const [view, setView] = useState<MonitorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    const pull = async () => {
      const book = peekBook(address);
      try {
        const balances = await readBalances(address);
        if (!live) return;
        setView(buildMonitor(address, book, balances));
        setError(null);
      } catch (err) {
        if (!live) return;
        setView(buildMonitor(address, book, null));
        setError(err instanceof Error ? err.message : "Could not read this wallet on-chain.");
      }
    };
    void pull();
    const id = window.setInterval(() => void pull(), 15_000);
    const onStore = (event: StorageEvent) => {
      if (event.key === `t800-trader-state:${address}`) void pull();
    };
    window.addEventListener("storage", onStore);
    return () => {
      live = false;
      window.clearInterval(id);
      window.removeEventListener("storage", onStore);
    };
  }, [address]);

  const copyLink = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("watch", address);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[rgba(5,5,8,0.82)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1100px] items-center gap-3 px-4 py-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-[rgba(255,74,216,0.12)] text-sm font-semibold text-[var(--magenta)]">
            T8
          </div>
          <div>
            <div className="text-sm font-medium">Watching the book</div>
            <div className="num text-[11px] text-[var(--faint)]">{shortAddress(address)}</div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Pill tone={view?.running ? "mint" : "default"}>{view?.running ? "Armed" : "Standby"}</Pill>
            <button onClick={() => void copyLink()} className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">
              {copied ? "Link copied" : "Copy link"}
            </button>
            <button onClick={onClose} className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">
              Close
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1100px] space-y-4 px-4 py-5">
        {error ? <p className="text-sm text-[var(--crimson)]">{error}</p> : null}
        {!view ? (
          <p className="text-sm text-[var(--muted)]">Reading {shortAddress(address)}…</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Wallet mark" value={view.walletEquityUsd === null ? "—" : usd(view.walletEquityUsd)} sub={view.sol === null ? "Chain read pending" : `${view.sol.toFixed(3)} SOL · ${(view.usdc ?? 0).toFixed(2)} USDC`} />
              <Stat label="Paper equity" value={view.paperEquityUsd === null ? "—" : usd(view.paperEquityUsd)} sub={<Spark values={view.equityCurve} />} />
              <Stat
                label="Day P&L"
                value={view.dayPnlUsd === null ? "—" : usd(view.dayPnlUsd)}
                tone={view.dayPnlUsd === null ? undefined : view.dayPnlUsd >= 0 ? "mint" : "crimson"}
              />
              <Stat
                label="Hit rate"
                value={view.hitRate === null ? "—" : `${view.hitRate.toFixed(0)}%`}
                sub={view.hasBook ? `${view.winCount}W / ${view.lossCount}L · ${view.ticks} ticks` : "No paper book here"}
              />
            </div>
            <section className="neon p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Label>Bot</Label>
                <span className="text-[11px] text-[var(--faint)]">
                  {view.lastTickAt ? `Last tick ${new Date(view.lastTickAt).toLocaleTimeString()}` : "No tick yet"}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                {view.hasBook
                  ? view.lastNote ?? "The book is on this browser. It updates when the bot ticks in another tab."
                  : "This browser has no paper book for that address. Live SOL and USDC still load. Arm the bot on this browser once and the blotter will show up here."}
              </p>
              {view.learningSummary ? <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{view.learningSummary}</p> : null}
            </section>
            <section className="neon overflow-x-auto p-5">
              <Label>Open tickets</Label>
              {view.positions.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--muted)]">Flat.</p>
              ) : (
                <table className="mt-3 w-full min-w-[640px] text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">
                    <tr>
                      <th className="py-2">Symbol</th>
                      <th>Side</th>
                      <th>Entry</th>
                      <th>Mark</th>
                      <th>P&L</th>
                      <th>R</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.positions.map((position) => {
                      const pnlPct = ((position.markPrice - position.entryPrice) / position.entryPrice) * 100 * (position.side === "long" ? 1 : -1);
                      const pnlUsd = position.qty * position.entryPrice * (pnlPct / 100);
                      return (
                        <tr key={position.id} className="border-t border-[var(--line)]">
                          <td className="py-3 font-medium">{position.symbol}</td>
                          <td>{position.side}</td>
                          <td className="num">{position.entryPrice}</td>
                          <td className="num">{position.markPrice}</td>
                          <td>
                            <Tone value={pnlUsd}>
                              {usd(pnlUsd)} {pct(pnlPct)}
                            </Tone>
                          </td>
                          <td className="num">{rMultiple(position).toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
            <section className="neon overflow-x-auto p-5">
              <Label>Trades</Label>
              {view.trades.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--muted)]">No fills stored for this address on this browser.</p>
              ) : (
                <table className="mt-3 w-full min-w-[640px] text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">
                    <tr>
                      <th className="py-2">When</th>
                      <th>Action</th>
                      <th>Symbol</th>
                      <th>Reason</th>
                      <th>P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.trades.slice(0, 20).map((trade) => (
                      <tr key={trade.id} className="border-t border-[var(--line)]">
                        <td className="py-3 text-[var(--muted)]">{new Date(trade.at).toLocaleString()}</td>
                        <td>{trade.action}</td>
                        <td className="font-medium">{trade.symbol}</td>
                        <td className="text-[var(--muted)]">{trade.reason}</td>
                        <td>{trade.pnlUsd === null ? "—" : <Tone value={trade.pnlUsd}>{usd(trade.pnlUsd)}</Tone>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
