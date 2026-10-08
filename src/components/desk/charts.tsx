"use client";

import { analyzeChart, type Bias } from "@/lib/market/analysis";
import type { Candle, TapeDot } from "@/lib/types";
import { priceFmt, usd } from "@/lib/utils";
import { useMemo, useState } from "react";

function rollingEma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = e;
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

function linePath(
  values: (number | null)[],
  xOf: (i: number) => number,
  yOf: (v: number) => number,
): string {
  return values
    .map((v, i) => (v === null ? "" : `${i && values[i - 1] !== null ? "L" : "M"}${xOf(i)},${yOf(v)}`))
    .join(" ");
}

export interface ChartLayers {
  ema9: boolean;
  ema21: boolean;
  vwap: boolean;
}

const ALL_LAYERS: ChartLayers = { ema9: true, ema21: true, vwap: true };

export function CandleChart({
  candles,
  layers = ALL_LAYERS,
  emptyLabel = "Waiting on the 4-hour chart",
}: {
  candles: Candle[];
  layers?: ChartLayers;
  emptyLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (candles.length < 1) {
    return <EmptyPlot label={emptyLabel} waiting />;
  }
  const w = 520;
  const h = 168;
  const pad = 10;
  const slice = candles.slice(-180);
  const highs = slice.map((c) => c.high);
  const lows = slice.map((c) => c.low);
  const closes = slice.map((c) => c.close);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = max - min || 1;
  const slot = (w - pad * 2) / slice.length;
  const bw = Math.max(1, Math.min(7, slot * 0.72));
  const xOf = (i: number) => pad + (i + 0.5) * slot;
  const y = (v: number) => pad + ((max - v) / span) * (h - pad * 2);
  const last = slice[slice.length - 1];
  const up = last.close >= last.open;
  const ema9 = rollingEma(closes, 9);
  const ema21 = rollingEma(closes, 21);
  let vwPv = 0;
  let vwVol = 0;
  const vwap = slice.map((c) => {
    const typical = (c.high + c.low + c.close) / 3;
    vwPv += typical * c.volume;
    vwVol += c.volume;
    return vwVol > 0 ? vwPv / vwVol : null;
  });
  const hot = hover === null ? null : slice[hover];
  const prevClose = hot && hover !== null && hover > 0 ? slice[hover - 1].close : hot?.open ?? 0;
  const hotChg = hot && prevClose ? ((hot.close - prevClose) / prevClose) * 100 : 0;
  const pick = (clientX: number, svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = ((clientX - rect.left) / rect.width) * w;
    const i = Math.floor((x - pad) / slot);
    setHover(Math.max(0, Math.min(slice.length - 1, i)));
  };
  return (
    <div className="relative h-full w-full">
      {hot ? (
        <div className="chart-readout num">
          <span>{new Date(hot.time * 1000).toLocaleTimeString()}</span>
          <span>O {priceFmt(hot.open)}</span>
          <span>H {priceFmt(hot.high)}</span>
          <span>L {priceFmt(hot.low)}</span>
          <span>C {priceFmt(hot.close)}</span>
          <span className={hotChg >= 0 ? "pos" : "neg"}>{hotChg >= 0 ? "+" : ""}{hotChg.toFixed(2)}%</span>
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-full w-full touch-pan-y"
        onPointerMove={(event) => pick(event.clientX, event.currentTarget)}
        onPointerLeave={() => setHover(null)}
      >
        {[0.25, 0.5, 0.75].map((p) => (
          <line
            key={p}
            x1={pad}
            x2={w - pad}
            y1={pad + (h - pad * 2) * p}
            y2={pad + (h - pad * 2) * p}
            stroke="var(--chart-grid)"
          />
        ))}
        {layers.vwap ? <path d={linePath(vwap, xOf, y)} fill="none" stroke="rgba(243,193,91,0.55)" strokeWidth="1.2" strokeDasharray="3 3" /> : null}
        {layers.ema21 ? <path d={linePath(ema21, xOf, y)} fill="none" stroke="rgba(121,212,255,0.7)" strokeWidth="1.3" /> : null}
        {layers.ema9 ? <path d={linePath(ema9, xOf, y)} fill="none" stroke="var(--magenta)" strokeWidth="1.4" /> : null}
        {slice.map((c, i) => {
          const x = xOf(i);
          const green = c.close >= c.open;
          const color = green ? "var(--mint)" : "var(--crimson)";
          const active = i === hover;
          return (
            <g key={`${c.time}-${i}`}>
              <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth={active ? 1.8 : 1.2} />
              <rect
                x={x - bw / 2}
                y={y(Math.max(c.open, c.close))}
                width={bw}
                height={Math.max(1.4, Math.abs(y(c.open) - y(c.close)))}
                rx="1"
                fill={color}
                opacity={hover === null || active ? 1 : 0.45}
              >
                <title>
                  {new Date(c.time * 1000).toLocaleString()} · O {priceFmt(c.open)} H {priceFmt(c.high)} L {priceFmt(c.low)} C {priceFmt(c.close)}
                </title>
              </rect>
            </g>
          );
        })}
        {hover !== null && hot ? (
          <g pointerEvents="none">
            <line x1={xOf(hover)} x2={xOf(hover)} y1={pad} y2={h - pad} stroke="var(--magenta)" strokeOpacity="0.45" />
            <line x1={pad} x2={w - pad} y1={y(hot.close)} y2={y(hot.close)} stroke="var(--ice)" strokeOpacity="0.35" />
            <circle cx={xOf(hover)} cy={y(hot.close)} r="3.2" fill="var(--text)" />
          </g>
        ) : null}
        <text x={w - pad} y={16} textAnchor="end" fill={up ? "var(--mint)" : "var(--crimson)"} fontSize="13" className="num">
          {priceFmt(last.close)}
        </text>
      </svg>
    </div>
  );
}

export interface TaLayers {
  emas: boolean;
  vwap: boolean;
  levels: boolean;
  trendlines: boolean;
  fib: boolean;
  swings: boolean;
}

export const ALL_TA_LAYERS: TaLayers = { emas: true, vwap: true, levels: true, trendlines: true, fib: true, swings: true };

export interface ChartTrade {
  side: "long" | "short";
  entry: number;
  stop: number;
  target: number;
}

const BIAS_TONE: Record<Bias, string> = { up: "var(--mint)", down: "var(--crimson)", range: "var(--amber)" };

/** Short price for tags inside the chart, without the currency sign. */
function tagPrice(v: number): string {
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (v >= 100) return v.toFixed(2);
  if (v >= 1) return v.toFixed(3);
  return v.toPrecision(3);
}

/** Push gutter tags apart so close levels stay readable. */
function spreadTags<T extends { y: number }>(tags: T[], gap: number, lo: number, hi: number): T[] {
  const sorted = [...tags].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) sorted[i].y = Math.max(sorted[i].y, sorted[i - 1].y + gap);
  const overflow = sorted.length ? sorted[sorted.length - 1].y - hi : 0;
  if (overflow > 0) for (const tag of sorted) tag.y -= overflow;
  for (let i = sorted.length - 2; i >= 0; i--) sorted[i].y = Math.min(sorted[i].y, sorted[i + 1].y - gap);
  for (const tag of sorted) tag.y = Math.max(lo, tag.y);
  return sorted;
}

function backCheckLine(bias: Bias): string {
  if (bias === "up") return "15m longs pass · shorts blocked";
  if (bias === "down") return "15m shorts pass · longs blocked";
  return "needs the 1h to pick a side";
}

/** The 4-hour chart with the bot's full read drawn on it. Uses the same analysis the bot back-checks against. */
export function AnalysisChart({
  candles,
  layers = ALL_TA_LAYERS,
  trade = null,
  emptyLabel = "Waiting on the 4-hour chart",
  title = "4H",
}: {
  candles: Candle[];
  layers?: TaLayers;
  trade?: ChartTrade | null;
  emptyLabel?: string;
  title?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const read = useMemo(() => (candles.length >= 30 ? analyzeChart(candles.slice(-180)) : null), [candles]);
  if (candles.length < 30 || !read) return <EmptyPlot label={candles.length ? `${emptyLabel} (${candles.length} bars so far)` : emptyLabel} waiting />;
  const all = candles.slice(-180);
  const offset = Math.max(0, all.length - 120);
  const slice = all.slice(offset);
  const n = slice.length;
  const W = 960;
  const H = 500;
  const left = 8;
  const gutter = 92;
  const right = W - gutter;
  const top = 34;
  const priceBottom = 340;
  const rsiTop = 362;
  const rsiBottom = 440;
  const axisY = 460;
  const lows = slice.map((c) => c.low);
  const highs = slice.map((c) => c.high);
  let min = Math.min(...lows);
  let max = Math.max(...highs);
  if (trade) {
    min = Math.min(min, trade.stop, trade.target, trade.entry);
    max = Math.max(max, trade.stop, trade.target, trade.entry);
  }
  const pad = (max - min) * 0.06 || max * 0.01;
  min -= pad;
  max += pad;
  const span = max - min || 1;
  const slot = (right - left) / n;
  const bw = Math.max(1.2, Math.min(7, slot * 0.68));
  const xOf = (i: number) => left + (i + 0.5) * slot;
  const y = (v: number) => top + ((max - v) / span) * (priceBottom - top);
  const inView = (v: number) => v >= min && v <= max;
  const ry = (v: number) => rsiTop + ((100 - v) / 100) * (rsiBottom - rsiTop);
  const local = (i: number) => i - offset;
  const shown = <T,>(series: T[]) => series.slice(offset);
  const maxVol = Math.max(...slice.map((c) => c.volume), 1);
  const last = slice[n - 1];
  const hot = hover === null ? null : slice[hover];
  const hotPrev = hot && hover ? slice[hover - 1].close : hot?.open ?? 0;
  const hotChg = hot && hotPrev ? ((hot.close - hotPrev) / hotPrev) * 100 : 0;
  const band = Math.max(read.atr * 0.3, read.last * 0.002);
  const rsiNow = read.rsiNow;
  const tone = BIAS_TONE[read.bias];
  const tickEvery = Math.max(1, Math.round(n / 6));
  const pick = (clientX: number, svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = ((clientX - rect.left) / rect.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.floor((x - left) / slot))));
  };
  const tagRows = spreadTags(
    [
      ...(layers.levels ? [...read.supports, ...read.resistances] : [])
        .filter((lv) => inView(lv.price))
        .map((lv) => ({
          key: `g${lv.kind}${lv.price}`,
          y: y(lv.price),
          at: y(lv.price),
          color: lv.kind === "support" ? "var(--mint)" : "var(--crimson)",
          text: `${lv.kind === "support" ? "S" : "R"} ${tagPrice(lv.price)}${lv.touches > 1 ? ` ×${lv.touches}` : ""}`,
          strong: false,
        })),
      { key: "last", y: y(last.close), at: y(last.close), color: last.close >= last.open ? "var(--mint)" : "var(--crimson)", text: `▸ ${tagPrice(last.close)}`, strong: true },
    ],
    17,
    top + 8,
    priceBottom - 8,
  );
  return (
    <div className="relative h-full w-full">
      {hot ? (
        <div className="chart-readout num">
          <span>{new Date(hot.time * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
          <span>O {priceFmt(hot.open)}</span>
          <span>H {priceFmt(hot.high)}</span>
          <span>L {priceFmt(hot.low)}</span>
          <span>C {priceFmt(hot.close)}</span>
          <span className={hotChg >= 0 ? "pos" : "neg"}>{hotChg >= 0 ? "+" : ""}{hotChg.toFixed(2)}%</span>
          {read.rsi[offset + (hover ?? 0)] != null ? <span>RSI {read.rsi[offset + (hover ?? 0)]!.toFixed(0)}</span> : null}
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-full w-full touch-pan-y"
        role="img"
        aria-label={`${title} technical analysis chart. ${read.notes.join(" ")}`}
        onPointerMove={(event) => pick(event.clientX, event.currentTarget)}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id="ta-price">
            <rect x={left} y={top} width={right - left} height={priceBottom - top} />
          </clipPath>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((p) => {
          const v = max - span * p;
          const yy = top + (priceBottom - top) * p;
          return (
            <g key={p}>
              <line x1={left} x2={right} y1={yy} y2={yy} stroke="var(--chart-grid)" />
              <text x={right - 4} y={yy - 3} textAnchor="end" fontSize="9" fill="var(--chart-label)" opacity="0.5" className="num">
                {tagPrice(v)}
              </text>
            </g>
          );
        })}
        {slice.map((c, i) =>
          i % tickEvery === 0 ? (
            <g key={`t${c.time}`}>
              <line x1={xOf(i)} x2={xOf(i)} y1={top} y2={rsiBottom} stroke="var(--chart-grid)" />
              <text x={xOf(i)} y={axisY} textAnchor={i === 0 ? "start" : "middle"} fontSize="9.5" fill="var(--chart-label)" className="num">
                {new Date(c.time * 1000).toLocaleDateString([], { month: "short", day: "numeric" })}
              </text>
            </g>
          ) : null,
        )}

        <g clipPath="url(#ta-price)">
          {slice.map((c, i) => {
            const vh = (c.volume / maxVol) * 56;
            return <rect key={`v${c.time}`} x={xOf(i) - bw / 2} y={priceBottom - vh} width={bw} height={vh} fill={c.close >= c.open ? "var(--mint)" : "var(--crimson)"} opacity="0.13" />;
          })}

          {layers.fib && read.fib
            ? read.fib.levels.map((lv) =>
                inView(lv.price) ? (
                  <g key={`f${lv.ratio}`}>
                    <line x1={left} x2={right} y1={y(lv.price)} y2={y(lv.price)} stroke="var(--amber)" strokeOpacity="0.38" strokeDasharray="2 4" />
                    <text x={left + 4} y={y(lv.price) - 3} fontSize="9.5" fill="var(--amber)" opacity="0.85" className="num">
                      Fib {(lv.ratio * 100).toFixed(1)}% · {tagPrice(lv.price)}
                    </text>
                  </g>
                ) : null,
              )
            : null}

          {layers.levels
            ? [...read.supports, ...read.resistances].map((lv) =>
                inView(lv.price) ? (
                  <g key={`l${lv.kind}${lv.price}`}>
                    <rect
                      x={left}
                      y={y(lv.price + band)}
                      width={right - left}
                      height={Math.max(2, y(lv.price - band) - y(lv.price + band))}
                      fill={lv.kind === "support" ? "var(--mint)" : "var(--crimson)"}
                      opacity={0.05 + Math.min(lv.touches, 4) * 0.025}
                    />
                    <line
                      x1={left}
                      x2={right}
                      y1={y(lv.price)}
                      y2={y(lv.price)}
                      stroke={lv.kind === "support" ? "var(--mint)" : "var(--crimson)"}
                      strokeOpacity="0.55"
                      strokeWidth={lv.touches >= 3 ? 1.4 : 1}
                    />
                  </g>
                ) : null,
              )
            : null}

          {layers.trendlines
            ? read.trendlines.map((line) => {
                const x1 = xOf(local(line.from.index));
                const endIdx = read.ema9.length - 1;
                const color = line.kind === "support" ? "var(--mint)" : "var(--crimson)";
                return (
                  <g key={`tl${line.kind}`}>
                    <line x1={x1} y1={y(line.from.price)} x2={xOf(local(endIdx))} y2={y(line.now)} stroke={color} strokeWidth="1.6" strokeOpacity="0.9" />
                    <circle cx={xOf(local(line.from.index))} cy={y(line.from.price)} r="2.6" fill={color} />
                    <circle cx={xOf(local(line.to.index))} cy={y(line.to.price)} r="2.6" fill={color} />
                    <text
                      x={Math.max(left + 4, x1 - 4)}
                      y={y(line.from.price) + (line.kind === "support" ? 15 : -8)}
                      fontSize="10"
                      fill={color}
                    >
                      {line.rising ? "Rising" : "Falling"} {line.kind}
                    </text>
                  </g>
                );
              })
            : null}

          {layers.vwap ? <path d={linePath(shown(read.vwap), xOf, y)} fill="none" stroke="var(--amber)" strokeOpacity="0.7" strokeWidth="1.2" strokeDasharray="4 3" /> : null}
          {layers.emas ? (
            <>
              <path d={linePath(shown(read.ema50), xOf, y)} fill="none" stroke="#b48cff" strokeWidth="1.4" strokeOpacity="0.85" />
              <path d={linePath(shown(read.ema21), xOf, y)} fill="none" stroke="var(--ice)" strokeWidth="1.4" />
              <path d={linePath(shown(read.ema9), xOf, y)} fill="none" stroke="var(--magenta)" strokeWidth="1.4" />
            </>
          ) : null}

          {slice.map((c, i) => {
            const green = c.close >= c.open;
            const color = green ? "var(--mint)" : "var(--crimson)";
            return (
              <g key={`c${c.time}`} opacity={hover === null || hover === i ? 1 : 0.55}>
                <line x1={xOf(i)} x2={xOf(i)} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="1.1" />
                <rect x={xOf(i) - bw / 2} y={y(Math.max(c.open, c.close))} width={bw} height={Math.max(1.2, Math.abs(y(c.open) - y(c.close)))} rx="0.8" fill={color} />
              </g>
            );
          })}

          {layers.swings
            ? read.pivots.map((p) => {
                const i = local(p.index);
                if (i < 0 || !p.label) return null;
                const above = p.kind === "high";
                const good = p.label === "HH" || p.label === "HL";
                return (
                  <text
                    key={`p${p.index}${p.kind}`}
                    x={xOf(i)}
                    y={above ? y(p.price) - 6 : y(p.price) + 13}
                    textAnchor="middle"
                    fontSize="9.5"
                    fontWeight="600"
                    fill={good ? "var(--mint)" : "var(--crimson)"}
                  >
                    {p.label}
                  </text>
                );
              })
            : null}

          {layers.emas
            ? read.crosses.map((mark) => {
                const i = local(mark.index);
                if (i < 0) return null;
                const bull = mark.dir === "bull";
                const yy = bull ? y(mark.price) + 22 : y(mark.price) - 22;
                return (
                  <g key={`x${mark.index}`}>
                    <path
                      d={bull ? `M${xOf(i)},${yy - 6} l5,8 h-10 z` : `M${xOf(i)},${yy + 6} l5,-8 h-10 z`}
                      fill={bull ? "var(--mint)" : "var(--crimson)"}
                    />
                    <title>{bull ? "EMA 9 crossed above EMA 21" : "EMA 9 crossed below EMA 21"}</title>
                  </g>
                );
              })
            : null}

          {trade ? (
            <g>
              {[
                { v: trade.target, c: "var(--mint)", t: "Goal" },
                { v: trade.entry, c: "var(--text)", t: trade.side === "long" ? "Bought" : "Shorted" },
                { v: trade.stop, c: "var(--crimson)", t: "Stop" },
              ].map((row) => (
                <g key={row.t}>
                  <line x1={left} x2={right} y1={y(row.v)} y2={y(row.v)} stroke={row.c} strokeDasharray="6 4" strokeWidth="1.3" />
                  <text x={right - 4} y={y(row.v) - 4} textAnchor="end" fontSize="10.5" fill={row.c}>
                    {row.t} {priceFmt(row.v)}
                  </text>
                </g>
              ))}
            </g>
          ) : null}
        </g>

        {tagRows.map((row) => (
          <g key={row.key}>
            {Math.abs(row.y - row.at) > 1 ? <line x1={right} x2={right + 4} y1={row.at} y2={row.y} stroke={row.color} strokeOpacity="0.6" /> : null}
            <rect x={right + 4} y={row.y - 8} width={gutter - 6} height={16} rx="3" fill={row.color} opacity={row.strong ? 0.32 : 0.16} />
            <text x={right + 8} y={row.y + 4} fontSize="10.5" fill={row.strong ? "var(--text)" : row.color} fontWeight={row.strong ? 600 : 400} className="num">
              {row.text}
            </text>
          </g>
        ))}

        <g>
          <rect x={left} y={4} width={Math.min(620, right - left)} height={24} rx="6" fill={tone} opacity="0.12" />
          <text x={left + 10} y={20} fontSize="12">
            <tspan fill={tone} fontWeight="600">
              {title} {read.bias === "range" ? "RANGE" : read.bias === "up" ? "UPTREND" : "DOWNTREND"}
            </tspan>
            <tspan dx="10" fontSize="11" fill="var(--chart-label)">
              {read.structure} · RSI {rsiNow === null ? "—" : rsiNow.toFixed(0)} · {backCheckLine(read.bias)}
            </tspan>
          </text>
        </g>

        <line x1={left} x2={right} y1={rsiTop} y2={rsiTop} stroke="var(--chart-grid)" />
        <line x1={left} x2={right} y1={rsiBottom} y2={rsiBottom} stroke="var(--chart-grid)" />
        {[70, 30].map((lv) => (
          <g key={`r${lv}`}>
            <line x1={left} x2={right} y1={ry(lv)} y2={ry(lv)} stroke={lv === 70 ? "var(--crimson)" : "var(--mint)"} strokeOpacity="0.4" strokeDasharray="3 3" />
            <text x={W - 4} y={ry(lv) + 3} textAnchor="end" fontSize="9.5" fill="var(--chart-label)" className="num">
              {lv}
            </text>
          </g>
        ))}
        <line x1={left} x2={right} y1={ry(50)} y2={ry(50)} stroke="var(--chart-grid)" strokeDasharray="2 4" />
        <path d={linePath(shown(read.rsi), xOf, ry)} fill="none" stroke="#b48cff" strokeWidth="1.3" />
        <text x={left + 4} y={rsiTop + 11} fontSize="9.5" fill="var(--chart-label)">
          RSI 14 {rsiNow === null ? "" : rsiNow.toFixed(0)}
        </text>

        {hover !== null && hot ? (
          <g pointerEvents="none">
            <line x1={xOf(hover)} x2={xOf(hover)} y1={top} y2={rsiBottom} stroke="var(--magenta)" strokeOpacity="0.45" />
            <line x1={left} x2={right} y1={y(hot.close)} y2={y(hot.close)} stroke="var(--ice)" strokeOpacity="0.35" />
          </g>
        ) : null}
      </svg>
    </div>
  );
}

/** The analysis drawn on the 4-hour chart, in words, with a key for each line. */
export function TaNotes({ candles }: { candles: Candle[] }) {
  const read = useMemo(() => (candles.length >= 30 ? analyzeChart(candles.slice(-180)) : null), [candles]);
  if (!read) return null;
  const key: [string, string, string?][] = [
    ["var(--magenta)", "EMA 9"],
    ["var(--ice)", "EMA 21"],
    ["#b48cff", "EMA 50 · RSI"],
    ["var(--amber)", "VWAP · Fibonacci", "dash"],
    ["var(--mint)", "Support · rising line · bullish cross ▲"],
    ["var(--crimson)", "Resistance · falling line · bearish cross ▼"],
  ];
  return (
    <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
      <ul className="space-y-0.5 text-xs leading-5 text-[var(--text)]">
        {read.notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
        {read.fib ? (
          <li className="text-[var(--muted)]">
            Fibonacci drawn on the {read.fib.direction === "up" ? "rally" : "drop"} from {priceFmt(read.fib.direction === "up" ? read.fib.swingLow.price : read.fib.swingHigh.price)} to{" "}
            {priceFmt(read.fib.direction === "up" ? read.fib.swingHigh.price : read.fib.swingLow.price)}.
          </li>
        ) : null}
      </ul>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-[var(--muted)] md:grid-cols-1">
        {key.map(([color, label, dash]) => (
          <li key={label} className="flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden="true">
              <line x1="0" x2="18" y1="3" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dash ? "4 3" : undefined} />
            </svg>
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ScatterTape({ dots, onPick }: { dots: TapeDot[]; onPick?: (mint: string) => void }) {
  const [hotMint, setHotMint] = useState<string | null>(null);
  if (dots.length === 0) return <EmptyPlot label="No live pool dots this cycle" />;
  const w = 920;
  const h = 220;
  const scores = dots.map((d) => d.score);
  const chgs = dots.map((d) => d.change24h);
  const minS = Math.min(...scores);
  const maxS = Math.max(...scores);
  const minC = Math.min(...chgs);
  const maxC = Math.max(...chgs);
  const sx = (s: number) => 28 + ((s - minS) / (maxS - minS || 1)) * (w - 56);
  const sy = (c: number) => 22 + (1 - (c - minC) / (maxC - minC || 1)) * (h - 44);
  const r = (liq: number) => Math.min(16, 3 + Math.sqrt(Math.max(liq, 0)) / 180);
  const hot = dots.find((d) => d.mint === hotMint) ?? null;
  return (
    <div className="relative h-full w-full">
      {hot ? (
        <div className="chart-readout num">
          <span>{hot.symbol}</span>
          <span>score {hot.score.toFixed(1)}</span>
          <span className={hot.change24h >= 0 ? "pos" : "neg"}>
            {hot.change24h >= 0 ? "+" : ""}
            {hot.change24h.toFixed(2)}%
          </span>
          <span>liq {Math.round(hot.liquidityUsd).toLocaleString()}</span>
        </div>
      ) : null}
      <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full">
        <line x1={28} x2={w - 28} y1={h / 2} y2={h / 2} stroke="var(--chart-grid)" />
        <line x1={w / 2} x2={w / 2} y1={16} y2={h - 16} stroke="var(--chart-grid)" />
        {dots.map((d) => {
          const up = d.change24h >= 0;
          const color = up ? "var(--mint)" : "var(--crimson)";
          const active = d.mint === hotMint;
          const radius = r(d.liquidityUsd) * (active ? 1.35 : 1);
          return (
            <g
              key={d.mint}
              onPointerEnter={() => setHotMint(d.mint)}
              onPointerLeave={() => setHotMint(null)}
              onClick={() => onPick?.(d.mint)}
              style={{ cursor: onPick ? "pointer" : "default" }}
            >
              <circle cx={sx(d.score)} cy={sy(d.change24h)} r={radius + 7} fill={color} opacity={active ? 0.22 : 0.1} />
              <circle cx={sx(d.score)} cy={sy(d.change24h)} r={radius} fill={color} opacity={hotMint && !active ? 0.35 : 0.88} />
              <text x={sx(d.score) + 9} y={sy(d.change24h) - 8} className="num" fill={active ? "var(--text)" : "var(--chart-label)"} fontSize={active ? 12 : 10}>
                {d.symbol}
              </text>
              <title>
                {d.symbol} · score {d.score.toFixed(1)} · {d.change24h.toFixed(2)}%
              </title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function EquityPath({ values }: { values: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = values.length === 1 ? [values[0], values[0]] : values;
  if (series.length < 2) return <EmptyPlot label="No live equity prints yet" />;
  const w = 360;
  const h = 110;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const pts = series.map((v, i) => {
    const x = (i / (series.length - 1)) * (w - 12) + 6;
    const y = h - 8 - ((v - min) / span) * (h - 18);
    return [x, y] as const;
  });
  const line = pts.map((p) => p.join(",")).join(" ");
  const area = `6,${h - 4} ${line} ${w - 6},${h - 4}`;
  const up = series[series.length - 1] >= series[0];
  const stroke = up ? "var(--mint)" : "var(--crimson)";
  const hot = hover === null ? null : pts[hover];
  const pick = (clientX: number, svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = ((clientX - rect.left) / rect.width) * w;
    let best = 0;
    let dist = Infinity;
    pts.forEach((point, index) => {
      const gap = Math.abs(point[0] - x);
      if (gap < dist) {
        dist = gap;
        best = index;
      }
    });
    setHover(best);
  };
  return (
    <div className="relative h-full w-full">
      {hot && hover !== null ? (
        <div className="chart-readout num">
          <span>{usd(series[hover])}</span>
        </div>
      ) : null}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-full w-full"
        onPointerMove={(event) => pick(event.clientX, event.currentTarget)}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="eqFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon fill="url(#eqFill)" points={area} />
        <polyline fill="none" stroke={stroke} strokeWidth="2.2" strokeLinejoin="round" points={line} />
        <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3.4" fill={stroke} />
        {hot ? (
          <g pointerEvents="none">
            <line x1={hot[0]} x2={hot[0]} y1={8} y2={h - 8} stroke="var(--magenta)" strokeOpacity="0.45" />
            <circle cx={hot[0]} cy={hot[1]} r="4" fill="var(--text)" />
          </g>
        ) : null}
      </svg>
    </div>
  );
}

export function VolumeBars({ candles }: { candles: Candle[] }) {
  const slice = candles.slice(-36);
  if (slice.length === 0) return <EmptyPlot label="No live volume bars" />;
  const w = 360;
  const h = 110;
  const max = Math.max(...slice.map((c) => c.volume), 1);
  const bw = Math.max(2, (w - 8) / slice.length - 1.2);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full">
      {slice.map((c, i) => {
        const x = 4 + i * ((w - 8) / slice.length);
        const bh = (c.volume / max) * (h - 14);
        const up = c.close >= c.open;
        return (
          <rect
            key={`${c.time}-${i}`}
            x={x}
            y={h - 6 - bh}
            width={bw}
            height={Math.max(1, bh)}
            rx="1.5"
            fill={up ? "var(--magenta)" : "var(--mint)"}
            opacity="0.88"
          />
        );
      })}
    </svg>
  );
}

function EmptyPlot({ label, waiting = false }: { label: string; waiting?: boolean }) {
  if (!waiting) {
    return (
      <div className="grid h-full min-h-[88px] place-items-center px-3 text-center text-[11px] uppercase tracking-[0.18em] text-[var(--faint)]">
        {label}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-[88px] flex-col justify-end px-2 pb-2">
      <div className="skel h-16 w-full" />
      <div className="mt-2 text-center text-[11px] tracking-[0.12em] text-[var(--muted)]">{label}</div>
    </div>
  );
}
