/**
 * Replay cached Binance 1-minute bars through the desk's own signal, risk, and
 * paper-book functions, one scan per minute, in the same order `tickBot` runs them.
 * Venue fees are charged on top of the paper slip so the result is closer to LIVE.
 *
 *   npx tsx scripts/fetch-candles.ts 45
 *   npx tsx scripts/backtest.ts [--equity 200] [--days 45] [--json]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Kline } from "./fetch-candles";

const RealDate = Date;
let simNow = RealDate.now();
class SimDate extends RealDate {
  constructor(...args: ConstructorParameters<DateConstructor> | []) {
    if (args.length === 0) super(simNow);
    else super(...(args as [string | number | Date]));
  }
  static now(): number {
    return simNow;
  }
}
(globalThis as { Date: DateConstructor }).Date = SimDate as unknown as DateConstructor;

const arg = (name: string, fallback: number) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? Number(process.argv[at + 1]) : fallback;
};
const EQUITY = arg("equity", 200);
const DAYS = arg("days", 45);
/** Stop this many days before the newest bar, so a later window can be held out. */
const HOLDOUT = arg("holdout", 0);
const AS_JSON = process.argv.includes("--json");
const CACHE = join(process.cwd(), ".cache", "candles");

async function main() {
  const { emptyState, solanaDefaults } = await import("../src/lib/store");
  const { SOL_MINT, PUMP_MINT, ZEC_MINT, RAY_MINT, WATCHLIST } = await import("../src/lib/market/universe");
  const risk = await import("../src/lib/trading/risk");
  const paper = await import("../src/lib/trading/paper");
  const { solanaEntrySignals, snapshotTechnical } = await import("../src/lib/trading/signals");
  const { keepEntry, cashExit } = await import("../src/lib/market/tape");
  const { advise, studyTape } = await import("../src/lib/trading/learn");
  const lev = await import("../src/lib/trading/leverage");
  const close = await import("../src/lib/trading/close");
  const { huntRank } = await import("../src/lib/trading/bot");
  type Candle = import("../src/lib/types").Candle;
  type TokenCandidate = import("../src/lib/types").TokenCandidate;
  type AppState = import("../src/lib/types").AppState;
  type MarketRegime = import("../src/lib/types").MarketRegime;
  type Signal = import("../src/lib/types").Signal;

  const BOOK = [
    { symbol: "SOL", pair: "SOLUSDT", mint: SOL_MINT },
    { symbol: "PUMP", pair: "PUMPUSDT", mint: PUMP_MINT },
    { symbol: "ZEC", pair: "ZECUSDT", mint: ZEC_MINT },
    { symbol: "RAY", pair: "RAYUSDT", mint: RAY_MINT },
  ];
  const load = (pair: string, tf: string) => JSON.parse(readFileSync(join(CACHE, `${pair}-${tf}.json`), "utf8")) as Kline[];
  const btc = load("BTCUSDT", "1m");
  const btcAt = new Map(btc.map((k, i) => [k[0], i]));
  const fng = (JSON.parse(readFileSync(join(CACHE, "fng.json"), "utf8")) as { data: { value: string; timestamp: string }[] }).data
    .map((row) => ({ t: Number(row.timestamp) * 1000, v: Number(row.value) }))
    .sort((a, b) => a.t - b.t);
  const fearAt = (t: number) => {
    let v: number | null = null;
    for (const row of fng) if (row.t <= t) v = row.v;
    return v;
  };

  const series = BOOK.map((b) => {
    const m = load(b.pair, "1m");
    const h4 = load(b.pair, "4h");
    const buysP = [0];
    const tradesP = [0];
    const quoteP = [0];
    for (const k of m) {
      const share = k[5] > 0 ? k[8] / k[5] : 0.5;
      buysP.push(buysP[buysP.length - 1] + k[7] * share);
      tradesP.push(tradesP[tradesP.length - 1] + k[7]);
      quoteP.push(quoteP[quoteP.length - 1] + k[6]);
    }
    const at = new Map(m.map((k, i) => [k[0], i]));
    const meta = WATCHLIST.find((w) => w.mint === b.mint)!;
    return { ...b, m, h4, buysP, tradesP, quoteP, at, sector: meta.sector, name: meta.name };
  });

  type Series = (typeof series)[number];
  const flow = (s: Series, i: number, n: number) => {
    const from = Math.max(0, i - n + 1);
    const buys = s.buysP[i + 1] - s.buysP[from];
    const trades = s.tradesP[i + 1] - s.tradesP[from];
    const prev = s.m[i - n]?.[4] ?? s.m[0][4];
    return {
      buys,
      sells: trades - buys,
      buyers: buys,
      sellers: trades - buys,
      volumeUsd: s.quoteP[i + 1] - s.quoteP[from],
      priceChangePct: ((s.m[i][4] - prev) / prev) * 100,
    };
  };
  const candidate = (s: Series, i: number): TokenCandidate => ({
    id: s.mint,
    chain: "solana",
    symbol: s.symbol,
    name: s.name,
    mint: s.mint,
    poolAddress: `pool-${s.symbol}`,
    dex: "replay",
    quoteSymbol: "USDC",
    priceUsd: s.m[i][4],
    marketCapUsd: null,
    fdvUsd: null,
    liquidityUsd: 5_000_000,
    volume24hUsd: s.quoteP[i + 1] - s.quoteP[Math.max(0, i - 1439)],
    poolCreatedAt: null,
    ageHours: 10_000,
    sector: s.sector,
    flows: { m5: flow(s, i, 5), m15: flow(s, i, 15), m30: flow(s, i, 30), h1: flow(s, i, 60), h6: flow(s, i, 360), h24: flow(s, i, 1440) },
    watchlist: true,
    sources: ["replay"],
    priceAgreement: "agree",
  });
  const fourHour = (s: Series, i: number): Candle[] => {
    const now = s.m[i][0] + 60_000;
    const span = 4 * 3_600_000;
    const done = s.h4.filter((k) => k[0] + span <= now).slice(-99);
    const bucket = Math.floor(now / span) * span;
    const rows: Candle[] = done.map((k) => ({ time: k[0] / 1000, open: k[1], high: k[2], low: k[3], close: k[4], volume: k[5] }));
    const startIdx = s.at.get(bucket);
    if (startIdx !== undefined && startIdx <= i) {
      const part = s.m.slice(startIdx, i + 1);
      rows.push({
        time: bucket / 1000,
        open: part[0][1],
        high: Math.max(...part.map((k) => k[2])),
        low: Math.min(...part.map((k) => k[3])),
        close: part[part.length - 1][4],
        volume: part.reduce((a, k) => a + k[5], 0),
      });
    }
    return rows;
  };

  const sol = series[0];
  const end = sol.m.length - 1 - HOLDOUT * 1440;
  const start = Math.max(1440, end - DAYS * 1440);
  const overrides = process.env.BT_CONFIG ? (JSON.parse(process.env.BT_CONFIG) as Record<string, unknown>) : {};
  let state: AppState = emptyState({ ...solanaDefaults(), ...overrides, startingEquity: EQUITY });
  state = { ...state, bot: { ...state.bot, running: true } };
  const seen = new Set<string>();
  const levByMint = new Map<string, number>();
  let fees = 0;
  let peak = EQUITY;
  let maxDd = 0;
  const closes: { symbol: string; side: string; reason: string; exit: string; pnl: number; fee: number; lev: number }[] = [];
  const entryReason = new Map<string, string>();
  const daily = new Map<string, number>();
  const gates = new Map<string, number>();

  for (let i = start; i <= end; i++) {
    simNow = sol.m[i][0] + 60_000;
    const rows = series.map((s) => {
      const j = s.at.get(sol.m[i][0]);
      return j === undefined ? null : { s, j, c: candidate(s, j) };
    }).filter(Boolean) as { s: Series; j: number; c: TokenCandidate }[];
    const bi = btcAt.get(sol.m[i][0]);
    const btc24 = bi !== undefined && bi >= 1440 ? (btc[bi][4] / btc[bi - 1440][4] - 1) * 100 : 0;
    const sol24 = rows[0].c.flows.h24.priceChangePct;
    const fear = fearAt(simNow);
    const riskOn = btc24 > 0.4 && sol24 > 0 && (fear === null || fear >= 45);
    const defensive = btc24 < -2 || (fear !== null && fear < 30) || sol24 < -5;
    const stance: MarketRegime["stance"] = defensive ? "defensive" : riskOn ? "risk-on" : "mixed";
    const regime = { stance } as MarketRegime;
    const prices = new Map(rows.map((r) => [r.c.mint, r.c.priceUsd]));
    const byMint = new Map(rows.map((r) => [r.c.mint, r.c]));

    let next = paper.markBook(state, prices);
    next = { ...next, positions: next.positions.map((p) => risk.presetBracket(p, next.config)) };
    next = { ...next, portfolio: risk.rollSession(next.portfolio) };
    if (next.bot.skipReentry && !close.reentryBlocked(next.bot.skipReentry, next.bot.skipReentry.mint)) {
      next = { ...next, bot: { ...next.bot, skipReentry: null } };
    }
    if (next.bot.bracketQuietUntil && !close.bracketQuiet(next.bot.bracketQuietUntil)) {
      next = { ...next, bot: { ...next.bot, bracketQuietUntil: null } };
    }
    let presetFilled = false;
    if (stance === "defensive") {
      for (const pos of [...next.positions]) {
        if (risk.shouldFlattenMeme(pos, stance)) next = paper.closePosition(next, pos.id, pos.markPrice, "risk-off");
      }
    }
    for (const pos of [...next.positions]) {
      const plan = risk.managePosition(pos, simNow, next.config);
      if (plan.exit) {
        next = paper.closePosition(next, pos.id, pos.markPrice, plan.exit);
        if (plan.exit === "stop" || plan.exit === "target") {
          presetFilled = true;
          next = {
            ...next,
            bot: { ...next.bot, skipReentry: close.reentryHold(pos.mint, simNow, plan.exit), bracketQuietUntil: close.bracketQuietUntil() },
          };
        }
        continue;
      }
      if (plan.nextStop) next = paper.updateStop(next, pos.id, plan.nextStop);
      if (plan.scale) {
        const saved = (next.config.scaleFractionPct ?? 50) / 100;
        const bank = (pos.leverage ?? 1) >= 5 ? Math.max(saved, 0.6) : saved;
        next = paper.scaleOut(next, pos.id, Math.min(0.75, Math.max(0.25, bank)));
      }
    }
    for (const pos of [...next.positions]) {
      const live = byMint.get(pos.mint);
      if (!live) continue;
      const m15 = live.flows.m15.priceChangePct;
      const m5 = live.flows.m5.priceChangePct;
      if (next.config.scratchEnabled === false) continue;
      if (cashExit(pos.side, m15)) {
        next = paper.closePosition(next, pos.id, pos.markPrice, "fade");
        continue;
      }
      if (risk.shouldScratch(pos, m5, m15)) {
        next = paper.closePosition(next, pos.id, pos.markPrice, "time");
      }
    }
    next = paper.markBook(next, prices);

    if (!risk.dayLossBreached(next.portfolio, next.config)) {
      const scored = rows.map((r) => ({ ...r.c, researchScore: 60 }));
      next = studyTape(next, scored, stance);
      const focus = [...scored].sort((a, b) => huntRank(b as never) - huntRank(a as never));
      const ctx = { stance, fearGreed: fear, solChange: sol24 };
      const signals: Signal[] = [];
      for (const token of focus) {
        const r = rows.find((row) => row.c.mint === token.mint)!;
        const bars = fourHour(r.s, r.j);
        const tech = bars.length >= 30 ? snapshotTechnical(bars) : null;
        signals.push(...solanaEntrySignals(token, tech, 60, next.config.allowShorts, ctx).filter((sig) => keepEntry(sig.side, token.flows.m15.priceChangePct)));
      }
      signals.sort((a, b) => b.confidence - a.confidence);
      let opened = 0;
      for (const signal of signals) {
        const advice = advise(signal, next.memory, stance);
        const learned = risk.withUserBracket(
          { ...signal, confidence: Math.min(97, Math.max(1, signal.confidence + advice.confidenceDelta)) },
          next.config,
        );
        if (close.reentryBlocked(next.bot.skipReentry, learned.mint)) continue;
        if (presetFilled || close.bracketQuiet(next.bot.bracketQuietUntil)) continue;
        if (opened >= 2 && next.config.oneTicketPerTick !== false) continue;
        if (advice.block) continue;
        const gate = risk.canOpen({ positions: next.positions, signal: learned, config: next.config, portfolio: next.portfolio, trades: next.trades, stance });
        if (gate) {
          gates.set(gate, (gates.get(gate) ?? 0) + 1);
          continue;
        }
        if (next.positions.some((p) => p.mint === learned.mint)) continue;
        const sized = risk.sizePosition({
          equity: next.portfolio.equityUsd,
          price: learned.price,
          stopPct: learned.stopPct,
          config: next.config,
          regime,
          researchScore: learned.researchScore,
          confidence: learned.confidence,
          lossStreak: risk.consecutiveLosses(next.trades),
          dayUsed: risk.dayLossUsedPct(next.portfolio, next.config),
        });
        const cashCap = risk.cashConcentration(next.portfolio.equityUsd, next.config);
        const wanted = lev.multiplierFor(next.config.multipliers, Math.max(signal.confidence, learned.confidence), learned.reason, learned.symbol, learned.mint);
        const ticket = lev.leveragedTicket(sized.notional * advice.sizeMul, next.portfolio.cashUsd, cashCap, wanted);
        let leverage = ticket.leverage;
        const collateralUsd = ticket.collateralUsd;
        if (leverage > 1 && !(collateralUsd + 1e-9 >= lev.PERP_MIN_COLLATERAL_USD)) leverage = 1;
        const qty = learned.price > 0 ? (collateralUsd * leverage) / learned.price : 0;
        if (collateralUsd < risk.MIN_TICKET_USD || qty <= 0) continue;
        const fill = leverage > 1 ? { signature: "", qty, price: learned.price, tokenDecimals: 9, leverage, collateralUsd } : undefined;
        const before = next.positions.length;
        next = paper.openPosition(next, learned, qty, stance, fill);
        if (next.positions.length > before) {
          opened += 1;
          levByMint.set(learned.mint, leverage);
          entryReason.set(learned.mint, `${learned.side} ${learned.reason} · ${learned.thesis.replace(learned.symbol, '').trim().split(/\s+/).slice(0, 4).join(' ')}`);
        }
      }
    }

    for (const trade of [...next.trades].reverse()) {
      if (seen.has(trade.id)) continue;
      seen.add(trade.id);
      const l = levByMint.get(trade.mint) ?? 1;
      // Paper fills already price the venue fee in; this only reports it.
      const fee = trade.qty * trade.price * (paper.venueFeeBps(trade.mint, trade.symbol, l) / 10_000);
      fees += fee;
      if (trade.action === "close") {
        closes.push({ symbol: trade.symbol, side: trade.side, reason: entryReason.get(trade.mint) ?? "?", exit: trade.reason, pnl: trade.pnlUsd ?? 0, fee, lev: l });
      }
    }
    state = paper.markBook(next, prices);
    const eq = state.portfolio.equityUsd;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, ((peak - eq) / peak) * 100);
    daily.set(new RealDate(simNow).toISOString().slice(0, 10), eq);
  }

  const final = state.portfolio.equityUsd;
  const wins = closes.filter((c) => c.pnl > 0);
  const losses = closes.filter((c) => c.pnl <= 0);
  const gross = (rows: typeof closes) => rows.reduce((a, c) => a + c.pnl, 0);
  const group = (key: (c: (typeof closes)[number]) => string) => {
    const out: Record<string, { n: number; pnl: number }> = {};
    for (const c of closes) {
      const k = key(c);
      out[k] ??= { n: 0, pnl: 0 };
      out[k].n += 1;
      out[k].pnl += c.pnl;
    }
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { n: v.n, pnl: Number(v.pnl.toFixed(2)) }]));
  };
  const days = (end - start) / 1440;
  const summary = {
    days: Number(days.toFixed(1)),
    startEquity: EQUITY,
    finalEquity: Number(final.toFixed(2)),
    returnPct: Number((((final - EQUITY) / EQUITY) * 100).toFixed(2)),
    maxDrawdownPct: Number(maxDd.toFixed(2)),
    closes: closes.length,
    perDay: Number((closes.length / days).toFixed(1)),
    winRatePct: closes.length ? Number(((wins.length / closes.length) * 100).toFixed(1)) : 0,
    profitFactor: losses.length && gross(losses) !== 0 ? Number((gross(wins) / -gross(losses)).toFixed(2)) : null,
    grossPnl: Number(gross(closes).toFixed(2)),
    fees: Number(fees.toFixed(2)),
    bySymbol: group((c) => c.symbol),
    byExit: group((c) => c.exit),
    byEntry: group((c) => c.reason),
    byLeverage: group((c) => `${c.lev}x`),
    blockedBy: Object.fromEntries([...gates.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)),
  };
  if (AS_JSON) console.log(JSON.stringify(summary));
  else console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
