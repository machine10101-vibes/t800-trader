"use client";

import type { ChainId } from "@/lib/chain";
import { tokenInitials, tokenLogoUrl } from "@/lib/market/logos";
import { useState } from "react";

export type TokenLogoSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE: Record<TokenLogoSize, string> = {
  xs: "h-4 w-4 text-[8px]",
  sm: "h-5 w-5 text-[9px]",
  md: "h-7 w-7 text-[10px]",
  lg: "h-9 w-9 text-[11px]",
  xl: "h-11 w-11 text-xs",
};

export function TokenLogo({
  symbol,
  mint,
  chain,
  size = "sm",
  className = "",
  title,
}: {
  symbol: string;
  mint?: string | null;
  chain?: ChainId;
  size?: TokenLogoSize;
  className?: string;
  title?: string;
}) {
  const src = tokenLogoUrl({ symbol, mint, chain });
  const [failed, setFailed] = useState(false);
  const label = title ?? symbol;
  const box = `token-logo ${SIZE[size]} ${className}`.trim();
  if (!src || failed) {
    return (
      <span className={`${box} token-logo-fallback`} aria-hidden title={label}>
        {tokenInitials(symbol)}
      </span>
    );
  }
  return (
    // Static export talks to CoinGecko and a local CRIMECAT mark. next/image cannot rewrite those.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      title={label}
      width={36}
      height={36}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={box}
      onError={() => setFailed(true)}
    />
  );
}

export function TokenMark({
  symbol,
  mint,
  chain,
  size = "sm",
  className = "",
}: {
  symbol: string;
  mint?: string | null;
  chain?: ChainId;
  size?: TokenLogoSize;
  className?: string;
}) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`.trim()}>
      <TokenLogo symbol={symbol} mint={mint} chain={chain} size={size} />
      <span className="truncate">{symbol}</span>
    </span>
  );
}
