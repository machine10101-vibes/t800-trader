"use client";

import type { ChainId } from "@/lib/chain";
import { cashDeskLabel, cashLegLine, formatCashAmount, formatCashUsd, nativeCashSymbol, type CashLeg } from "@/lib/cashHoldings";
import { TokenLogo } from "./TokenLogo";

export function CashLegs({
  legs,
  chain,
  dense = false,
}: {
  legs: CashLeg[];
  chain: ChainId;
  dense?: boolean;
}) {
  return (
    <ul className={`mt-2 space-y-1 ${dense ? "" : ""}`} aria-label="Token balances">
      {legs.map((leg) => (
        <li key={leg.symbol} className="flex min-w-0 items-center justify-between gap-2 text-xs">
          <span className="flex min-w-0 items-center gap-1.5 font-medium text-[var(--text)]">
            <TokenLogo symbol={leg.symbol} chain={chain} size="xs" />
            {leg.symbol}
          </span>
          <span className="num shrink-0 text-[var(--muted)]">{cashLegLine(leg)}</span>
        </li>
      ))}
    </ul>
  );
}

export function WalletUsdcChip({
  usdc,
  chain,
}: {
  usdc: number;
  chain: ChainId;
}) {
  return (
    <div className="text-right" title="Connected wallet USDC">
      <div className="flex items-center justify-end gap-1.5 text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">
        <TokenLogo symbol="USDC" chain={chain} size="xs" />
        Wallet USDC
      </div>
      <div className="num">{cashLegLine({ symbol: "USDC", amount: usdc, usd: usdc })}</div>
    </div>
  );
}

export function cashPanelTitle(live: boolean, armed: boolean): string {
  return cashDeskLabel(live, armed);
}

/** Full-width USDC + SOL / USDC + CRO strip used on Home, Charts, and History. */
export function CashPanel({
  title,
  totalUsd,
  legs,
  chain,
  walletUsdc,
  note,
}: {
  title: string;
  totalUsd?: number;
  legs: CashLeg[];
  chain: ChainId;
  walletUsdc?: number;
  note?: string;
}) {
  const native = nativeCashSymbol(chain);
  return (
    <section className="cash-panel neon p-4 sm:p-5" aria-label={`${title} token balances`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">{title}</div>
          {totalUsd !== undefined ? <div className="num mt-1 text-2xl sm:text-3xl">{formatCashUsd(totalUsd)}</div> : null}
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            {note ?? `USDC and ${native} held on this desk.`}
          </p>
        </div>
        {walletUsdc !== undefined ? <WalletUsdcChip usdc={walletUsdc} chain={chain} /> : null}
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {legs.map((leg) => (
          <li key={leg.symbol} className="cash-leg-card">
            <TokenLogo symbol={leg.symbol} chain={chain} size="lg" />
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--faint)]">{leg.symbol}</div>
              <div className="num mt-0.5 text-xl font-medium text-[var(--text)]">{formatCashAmount(leg.symbol, leg.amount)}</div>
              {leg.symbol === "USDC" ? null : <div className="num text-xs text-[var(--muted)]">{formatCashUsd(leg.usd)}</div>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
