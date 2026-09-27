import type { Candle, TokenCandidate } from "@/lib/types";

/** Close-to-close percent move over `barsBack` completed 1-minute bars. */
export function candleChangePct(candles: Candle[], barsBack: number): number | null {
  if (candles.length <= barsBack) return null;
  const last = candles[candles.length - 1]?.close ?? 0;
  const prev = candles[candles.length - 1 - barsBack]?.close ?? 0;
  if (!(last > 0) || !(prev > 0)) return null;
  return ((last - prev) / prev) * 100;
}

/** Replace the short windows with the 1-minute bars the chart draws. 5m is five closes, 15m is fifteen. */
export function withCandleTape(candidate: TokenCandidate, candles: Candle[] | null | undefined): TokenCandidate {
  if (!candles?.length) return candidate;
  const flows = { ...candidate.flows };
  const apply = (tf: "m5" | "m15" | "m30" | "h1", bars: number) => {
    const change = candleChangePct(candles, bars);
    if (change === null) return;
    flows[tf] = { ...flows[tf], priceChangePct: Number(change.toFixed(4)) };
  };
  apply("m5", 5);
  apply("m15", 15);
  apply("m30", 30);
  apply("h1", 60);
  return { ...candidate, flows };
}

/**
 * Newest close between the 1-minute bars and the live prints.
 * Used to mark an open ticket. Signals keep using the 1-minute bars alone.
 */
export function printClose(candles: Candle[] | null | undefined, prints: Candle[] | undefined): number | null {
  const bar = candles?.length ? candles[candles.length - 1] : undefined;
  const print = prints?.length ? prints[prints.length - 1] : undefined;
  const pick = !bar ? print : !print ? bar : bar.time >= print.time ? bar : print;
  return pick && pick.close > 0 ? pick.close : null;
}

/**
 * Append a live print so a tape can draw before the 1-minute fetch lands.
 * Prints inside 4 seconds update the last bar instead of adding another one.
 */
export function pushTapeMark(rows: Candle[], price: number, atMs: number): Candle[] {
  if (!(price > 0)) return rows;
  const sec = Math.floor(atMs / 1000);
  const last = rows[rows.length - 1];
  if (last && last.close === price && sec - last.time < 4) return rows;
  if (last && sec - last.time < 4) {
    return [
      ...rows.slice(0, -1),
      { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price },
    ];
  }
  const open = last?.close ?? price;
  return [
    ...rows,
    { time: sec, open, high: Math.max(open, price), low: Math.min(open, price), close: price, volume: 0 },
  ].slice(-90);
}

/** Group 1-minute bars into N-minute OHLC. Indicators stay on the 5-minute clock. */
export function foldCandles(candles: Candle[], minutes: number): Candle[] {
  if (minutes <= 1 || candles.length < 2) return candles;
  const span = minutes * 60;
  const out: Candle[] = [];
  for (const candle of candles) {
    const bucket = Math.floor(candle.time / span) * span;
    const last = out[out.length - 1];
    if (!last || last.time !== bucket) {
      out.push({ ...candle, time: bucket });
      continue;
    }
    last.high = Math.max(last.high, candle.high);
    last.low = Math.min(last.low, candle.low);
    last.close = candle.close;
    last.volume += candle.volume;
  }
  return out;
}

/** A clearly red 15m stays in cash. A flat 15m can still take 5x or 10x when the 5m is not red. */
export function tapeRead(symbol: string, m5: number, m15: number, h1: number): string {
  const head =
    m15 <= -0.25
      ? `${symbol} 15m is red at ${m15.toFixed(2)}%. The book stays in cash.`
      : m15 < 0.1
        ? `${symbol} 15m is flat at ${m15.toFixed(2)}%. A 5x or 10x long is still eligible when the 5m is not red.`
        : `${symbol} 15m is green at ${m15.toFixed(2)}%. A long is eligible when the 5m tape agrees.`;
  return `${head} 5m ${m5.toFixed(2)}%, 1h ${h1.toFixed(2)}%.`;
}

/** Only a clearly red 15m stays in cash. Flat tape can still open 5x or 10x. */
export function tapeInCash(m15: number): boolean {
  return m15 <= -0.25;
}

export function tickPass(symbol: string, m15: number): string {
  if (m15 <= -0.25) return `${symbol}: 15m is red (${m15.toFixed(2)}%), staying in cash`;
  if (m15 < 0.1) return `${symbol}: 15m is flat (${m15.toFixed(2)}%), waiting on a 5m that can take 5x or 10x`;
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
  const parts = names.map((name) => ({ label: name.label, call: assetCall(name.symbol, signals, blocked) }));
  const lines: string[] = [];
  for (let i = 0; i < parts.length; ) {
    let j = i + 1;
    while (j < parts.length && parts[j].call === parts[i].call) j += 1;
    const labels = parts.slice(i, j).map((part) => part.label);
    lines.push(labels.length > 1 ? `${labels.join(", ")} ${parts[i].call}` : `${labels[0]} ${parts[i].call}`);
    i = j;
  }
  return `Tick ${tick} · ${lines.join(" · ")}${arm}`;
}
