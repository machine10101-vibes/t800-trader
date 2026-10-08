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

const JUPITER_INTERVAL: Record<Frame, string> = { "5m": "5_MINUTE", "15m": "15_MINUTE", "1h": "1_HOUR", "4h": "4_HOUR" };

export function jupiterInterval(frame: Frame): string {
  return JUPITER_INTERVAL[frame];
}

/**
 * Cronos reads two Gecko series per coin and rolls the rest up, so five coins cost ten calls a refresh, not twenty.
 * 1000 five-minute bars cover about three days (333 fifteen-minute bars); 1000 hourly bars cover about forty days.
 */
export function cronosSource(frame: Frame): Frame {
  return frame === "5m" || frame === "15m" ? "5m" : "1h";
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
