import type { Candle } from "@/lib/types";

/** About fifty days of native 4-hour bars. Jupiter returns the series already built. */
export const JUPITER_CHART_BARS = 300;

const CHART_URL = "https://datapi.jup.ag/v2/charts";

/** Candles for one Solana mint, from Jupiter. The decision chart is the 4-hour series. */
export function jupiterChartUrl(
  mint: string,
  toMs: number,
  candles = JUPITER_CHART_BARS,
  interval = "4_HOUR",
): string {
  const params = new URLSearchParams({
    interval,
    to: String(toMs),
    candles: String(candles),
    type: "price",
    quote: "usd",
  });
  return `${CHART_URL}/${mint}?${params.toString()}`;
}

export function parseJupiterCandles(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) return [];
  const out: Candle[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const bar = row as { time?: unknown; open?: unknown; high?: unknown; low?: unknown; close?: unknown; volume?: unknown };
    const time = Number(bar.time);
    const open = Number(bar.open);
    const high = Number(bar.high);
    const low = Number(bar.low);
    const close = Number(bar.close);
    const volume = Number(bar.volume);
    if (!(time > 0) || !(close > 0) || !(open > 0) || !(high > 0) || !(low > 0)) continue;
    out.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
  }
  return out.sort((a, b) => a.time - b.time);
}
