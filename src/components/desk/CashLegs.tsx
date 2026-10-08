"use client";

import type { ChainId } from "@/lib/chain";
import { cashLegLine, type CashLeg } from "@/lib/cashHoldings";
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
