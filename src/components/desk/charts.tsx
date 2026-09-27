"use client";

import type { Candle, TapeDot } from "@/lib/types";
import { priceFmt, usd } from "@/lib/utils";
import { useState } from "react";

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

export function CandleChart({ candles, layers = ALL_LAYERS }: { candles: Candle[]; layers?: ChartLayers }) {
  const [hover, setHover] = useState<number | null>(null);
  if (candles.length < 1) {
    return <EmptyPlot label="Waiting on the 1-minute tape" waiting />;
  }
  const w = 520;
  const h = 168;
  const pad = 10;
  const slice = candles.slice(-72);
  const highs = slice.map((c) => c.high);
  const lows = slice.map((c) => c.low);
  const closes = slice.map((c) => c.close);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = max - min || 1;
  const bw = Math.max(2.2, (w - pad * 2) / slice.length - 1.4);
  const slot = (w - pad * 2) / slice.length;
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
                  {new Date(c.time * 1000).toLocaleString()} · O {c.open} H {c.high} L {c.low} C {c.close}
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
        <text x={w - pad} y={14} textAnchor="end" fill={up ? "var(--mint)" : "var(--crimson)"} fontSize="10" className="num">
          {priceFmt(last.close)}
        </text>
      </svg>
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
