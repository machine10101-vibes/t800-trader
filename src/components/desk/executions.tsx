"use client";

import { txUrl, type ChainId } from "@/lib/chain";
import { executionLine, sizeText, tradeTally } from "@/lib/trading/blotter";
import type { Trade } from "@/lib/types";
import { pct, priceFmt, usd } from "@/lib/utils";
import { Tone } from "./bits";

export function ExecutionLog({
  trades,
  chain,
  empty,
}: {
  trades: Trade[];
  chain: ChainId;
  empty: string;
}) {
  const tally = tradeTally(trades);
  if (!tally.total) return <p className="text-sm text-[var(--muted)]">{empty}</p>;
  return (
    <div>
      <p className="mb-2 text-[11px] text-[var(--faint)]">
        {tally.total} trades · {tally.closed} closed · {tally.opened} opened
      </p>
      <div className="desk-scroll max-h-80 space-y-2 overflow-y-auto">
        {trades.map((trade) => {
          const line = executionLine(trade);
          return (
            <div key={line.id} className="rounded-xl border border-[var(--line)] px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">
                    {line.verb} {line.symbol}{" "}
                    <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--faint)]">{line.side}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--muted)]">
                    {sizeText(line.qty)} @ {priceFmt(line.price)} · {usd(line.notionalUsd)}
                  </div>
                  <div className="mt-0.5 text-xs leading-5 text-[var(--text)]">{line.why}</div>
                  <div className="text-[10px] text-[var(--faint)]">{new Date(line.at).toLocaleString()}</div>
                </div>
                <div className="shrink-0 text-right">
                  {line.pnlUsd === null ? (
                    <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--faint)]">
                      {line.verb === "Opened" ? "Open" : "—"}
                    </span>
                  ) : (
                    <>
                      <Tone value={line.pnlUsd}>{usd(line.pnlUsd)}</Tone>
                      {line.pnlPct !== null ? (
                        <div className="text-[10px]">
                          <Tone value={line.pnlPct}>{pct(line.pnlPct)}</Tone>
                        </div>
                      ) : null}
                    </>
                  )}
                  <div className="mt-1">{txLink(line.signature, chain)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function txLink(signature: string | undefined, chain: ChainId) {
  if (!signature) return <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">Simulated</span>;
  if (signature === "held") {
    return <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">Held in the trading key</span>;
  }
  const short = signature.length > 10 ? `${signature.slice(0, 4)}…${signature.slice(-4)}` : signature;
  return (
    <a className="num text-[11px] text-[var(--mint)]" href={txUrl(chain, signature)} target="_blank" rel="noreferrer">
      {short}
    </a>
  );
}
