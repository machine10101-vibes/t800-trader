import type { Candle, TokenCandidate } from "@/lib/types";

/** Close-to-close percent move over `barsBack` completed 5-minute bars. */
export function candleChangePct(candles: Candle[], barsBack: number): number | null {
  if (candles.length <= barsBack) return null;
  const last = candles[candles.length - 1]?.close ?? 0;
  const prev = candles[candles.length - 1 - barsBack]?.close ?? 0;
  if (!(last > 0) || !(prev > 0)) return null;
  return ((last - prev) / prev) * 100;
}

/** Replace the short windows with the same 5-minute bars the chart draws. */
export function withCandleTape(candidate: TokenCandidate, candles: Candle[] | null | undefined): TokenCandidate {
  if (!candles?.length) return candidate;
  const flows = { ...candidate.flows };
  const apply = (tf: "m5" | "m15" | "m30" | "h1", bars: number) => {
    const change = candleChangePct(candles, bars);
    if (change === null) return;
    flows[tf] = { ...flows[tf], priceChangePct: Number(change.toFixed(4)) };
  };
  apply("m5", 1);
  apply("m15", 3);
  apply("m30", 6);
  apply("h1", 12);
  return { ...candidate, flows };
}

/** The sentence research and the tick share. Red or flat 15m stays in cash. */
export function tapeRead(symbol: string, m5: number, m15: number, h1: number): string {
  const head =
    m15 < 0
      ? `${symbol} 15m is red at ${m15.toFixed(2)}%. The book stays in cash.`
      : m15 < 0.1
        ? `${symbol} 15m is flat at ${m15.toFixed(2)}%. No new long until that window is green.`
        : `${symbol} 15m is green at ${m15.toFixed(2)}%. A long is eligible when the 5m tape agrees.`;
  return `${head} 5m ${m5.toFixed(2)}%, 1h ${h1.toFixed(2)}%.`;
}

/** Red or flat 15m stays in cash. A long needs the same 0.1% green bar the tape names. */
export function tapeInCash(m15: number): boolean {
  return !(m15 >= 0.1);
}

export function tickPass(symbol: string, m15: number): string {
  if (m15 < 0) return `${symbol}: 15m is red (${m15.toFixed(2)}%), staying in cash`;
  if (m15 < 0.1) return `${symbol}: 15m is flat (${m15.toFixed(2)}%), staying in cash`;
  return `${symbol}: 15m is green (${m15.toFixed(2)}%), and the 5m tape did not confirm a long`;
}

export function assetCall(
  symbol: string,
  signals: Array<{ symbol: string; side: string; reason: string; confidence: number }>,
  blocked: string[],
): string {
  const sig = signals.find((s) => s.symbol === symbol);
  if (sig) return `${sig.side} ${sig.reason} ${Math.round(sig.confidence)}`;
  const line = blocked.find((b) => b.startsWith(`${symbol}:`));
  if (!line) return "waiting on the tape";
  return line.slice(symbol.length + 1).trim();
}

/** One line that names every asset on this chain's book. Solana names SOL and Zebec. */
export function tickHeadline(
  tick: number,
  signals: Array<{ symbol: string; side: string; reason: string; confidence: number }>,
  blocked: string[],
  armed: boolean,
  names: { symbol: string; label: string }[] = [
    { symbol: "SOL", label: "SOL" },
    { symbol: "ZBCN", label: "Zebec" },
  ],
): string {
  const arm = armed ? "" : " · arm to send";
  const body = names.map((name) => `${name.label} ${assetCall(name.symbol, signals, blocked)}`).join(" · ");
  return `Tick ${tick} · ${body}${arm}`;
}
