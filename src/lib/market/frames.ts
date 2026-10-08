import type { ChainId } from "@/lib/chain";
import type { Candle } from "@/lib/types";

export type Frame = "5m" | "15m" | "1h" | "4h";

export const FRAMES: Frame[] = ["5m", "15m", "1h", "4h"];

export const FRAME_SECONDS: Record<Frame, number> = { "5m": 300, "15m": 900, "1h": 3_600, "4h": 14_400 };

export const FRAME_LABEL: Record<Frame, string> = {
  "5m": "5-minute",
  "15m": "15-minute",
  "1h": "1-hour",
  "4h": "4-hour",
};

/** The forming bar moves every tick, so short frames re-read faster than the 4-hour. */
export const FRAME_REFRESH_MS: Record<Frame, number> = { "5m": 45_000, "15m": 60_000, "1h": 90_000, "4h": 120_000 };

/** Bars kept per frame. Enough for EMA 50 and a month of 4-hour structure. */
export const FRAME_BARS = 300;

/** 15-minute and 1-hour need a full EMA window. A new pool will not have thirty 4-hour bars yet. */
export const MIN_FRAME_BARS = 30;
export const MIN_FOUR_HOUR_BARS = 8;

export function enoughFrameBars(frame: Frame, count: number): boolean {
  return count >= (frame === "4h" ? MIN_FOUR_HOUR_BARS : MIN_FRAME_BARS);
}

const JUPITER_INTERVAL: Record<Frame, string> = { "5m": "5_MINUTE", "15m": "15_MINUTE", "1h": "1_HOUR", "4h": "4_HOUR" };

export function jupiterInterval(frame: Frame): string {
  return JUPITER_INTERVAL[frame];
}

/**
 * One native series fills the rest. Cronos 15-minute (1000 bars) covers the 1-hour and 4-hour back-check.
 * Solana 15-minute (300 bars) covers the 1-hour; the 4-hour still needs its own Jupiter read.
 */
export function sourceFrame(chain: ChainId, frame: Frame): Frame {
  if (frame === "5m") return "5m";
  if (chain === "cronos") return "15m";
  return frame === "1h" ? "15m" : frame;
}

/** Longer frames built from a shorter series. A thin roll-up is still better than an empty chart. */
export function derivedFrames(rows: Candle[], source: Frame): Partial<Record<Frame, Candle[]>> {
  const out: Partial<Record<Frame, Candle[]>> = { [source]: rows };
  if (source === "5m") {
    out["15m"] = rollUp(rows, FRAME_SECONDS["15m"]);
    out["1h"] = rollUp(rows, FRAME_SECONDS["1h"]);
    out["4h"] = rollUp(rows, FRAME_SECONDS["4h"]);
  } else if (source === "15m") {
    out["1h"] = rollUp(rows, FRAME_SECONDS["1h"]);
    out["4h"] = rollUp(rows, FRAME_SECONDS["4h"]);
  } else if (source === "1h") {
    out["4h"] = rollUp(rows, FRAME_SECONDS["4h"]);
  }
  return out;
}

export function geckoFrameUrl(network: string, address: string, kind: "pools" | "tokens", frame: Frame): string {
  const path = frame === "5m" ? "minute?aggregate=5" : frame === "15m" ? "minute?aggregate=15" : frame === "1h" ? "hour?aggregate=1" : "hour?aggregate=4";
  return `https://api.geckoterminal.com/api/v2/networks/${network}/${kind}/${address}/ohlcv/${path}&limit=1000&currency=usd`;
}

/** Bucket bars into a longer frame on UTC boundaries. Gaps in thin pools just leave fewer bars. */
export function rollUp(candles: Candle[], seconds: number): Candle[] {
  const out: Candle[] = [];
  for (const bar of [...candles].sort((a, b) => a.time - b.time)) {
    const start = Math.floor(bar.time / seconds) * seconds;
    const last = out[out.length - 1];
    if (last && last.time === start) {
      last.high = Math.max(last.high, bar.high);
      last.low = Math.min(last.low, bar.low);
      last.close = bar.close;
      last.volume += bar.volume;
      continue;
    }
    out.push({ time: start, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume });
  }
  return out;
}

export function frameKey(chain: ChainId, mint: string, frame: Frame): string {
  return `${chain}:${chain === "cronos" ? mint.toLowerCase() : mint}:${frame}`;
}

/** Drop the bar that is still printing. Setups read only closed candles. */
export function closedCandles(candles: Candle[], seconds: number, nowSec = Date.now() / 1000): Candle[] {
  const last = candles[candles.length - 1];
  if (last && last.time + seconds > nowSec) return candles.slice(0, -1);
  return candles;
}
