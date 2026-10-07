/**
 * Download public Binance 1-minute and 4-hour bars for the Solana book so
 * `scripts/backtest.ts` can replay them. Nothing here touches a wallet.
 *
 *   npx tsx scripts/fetch-candles.ts [days=30]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = "https://data-api.binance.vision/api/v3/klines";
export const BOOK_SYMBOLS = ["SOLUSDT", "PUMPUSDT", "ZECUSDT", "RAYUSDT", "BTCUSDT"] as const;
export const CACHE_DIR = join(process.cwd(), ".cache", "candles");

/** [openMs, open, high, low, close, volume, quoteVolume, trades, takerBuyBase] */
export type Kline = [number, number, number, number, number, number, number, number, number];

async function page(symbol: string, interval: string, startMs: number): Promise<Kline[]> {
  const url = `${BASE}?symbol=${symbol}&interval=${interval}&startTime=${startMs}&limit=1000`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.ok) {
      const rows = (await res.json()) as unknown[][];
      return rows.map((r) => [
        Number(r[0]),
        Number(r[1]),
        Number(r[2]),
        Number(r[3]),
        Number(r[4]),
        Number(r[5]),
        Number(r[7]),
        Number(r[8]),
        Number(r[9]),
      ]);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
  throw new Error(`${symbol} ${interval}: Binance did not answer`);
}

async function series(symbol: string, interval: string, startMs: number, stepMs: number): Promise<Kline[]> {
  const out: Kline[] = [];
  let cursor = startMs;
  while (cursor < Date.now() - stepMs) {
    const rows = await page(symbol, interval, cursor);
    if (!rows.length) break;
    out.push(...rows);
    cursor = rows[rows.length - 1][0] + stepMs;
  }
  return out;
}

async function main() {
  const days = Number(process.argv[2] ?? 30);
  mkdirSync(CACHE_DIR, { recursive: true });
  const start = Date.now() - days * 86_400_000;
  for (const symbol of BOOK_SYMBOLS) {
    const minute = await series(symbol, "1m", start - 86_400_000, 60_000);
    const fourHour = await series(symbol, "4h", start - 120 * 4 * 3_600_000, 4 * 3_600_000);
    writeFileSync(join(CACHE_DIR, `${symbol}-1m.json`), JSON.stringify(minute));
    writeFileSync(join(CACHE_DIR, `${symbol}-4h.json`), JSON.stringify(fourHour));
    console.log(`${symbol}: ${minute.length} 1m bars, ${fourHour.length} 4h bars`);
  }
  const fng = await fetch(`https://api.alternative.me/fng/?limit=${days + 5}`).then((r) => r.json());
  writeFileSync(join(CACHE_DIR, "fng.json"), JSON.stringify(fng));
  console.log("fear & greed saved");
}

if (process.argv[1]?.endsWith("fetch-candles.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
