import type { Candle, TapeDot } from "@/lib/types";

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

export function CandleChart({ candles }: { candles: Candle[] }) {
  if (candles.length < 1) {
    return <EmptyPlot label="No live OHLCV for this pool" />;
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
  const xOf = (i: number) => pad + (i + 0.5) * ((w - pad * 2) / slice.length);
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
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full">
      {[0.25, 0.5, 0.75].map((p) => (
        <line
          key={p}
          x1={pad}
          x2={w - pad}
          y1={pad + (h - pad * 2) * p}
          y2={pad + (h - pad * 2) * p}
          stroke="rgba(255,255,255,0.05)"
        />
      ))}
      <path d={linePath(vwap, xOf, y)} fill="none" stroke="rgba(243,193,91,0.55)" strokeWidth="1.2" strokeDasharray="3 3" />
      <path d={linePath(ema21, xOf, y)} fill="none" stroke="rgba(121,212,255,0.7)" strokeWidth="1.3" />
      <path d={linePath(ema9, xOf, y)} fill="none" stroke="rgba(255,74,216,0.85)" strokeWidth="1.4" />
      {slice.map((c, i) => {
        const x = xOf(i);
        const green = c.close >= c.open;
        const color = green ? "#3ee8a8" : "#ff3b8f";
        return (
          <g key={`${c.time}-${i}`}>
            <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="1.2" />
            <rect
              x={x - bw / 2}
              y={y(Math.max(c.open, c.close))}
              width={bw}
              height={Math.max(1.4, Math.abs(y(c.open) - y(c.close)))}
              rx="1"
              fill={color}
            >
              <title>
                {new Date(c.time * 1000).toLocaleString()} · O {c.open} H {c.high} L {c.low} C {c.close}
              </title>
            </rect>
          </g>
        );
      })}
      <text x={w - pad} y={14} textAnchor="end" fill={up ? "#3ee8a8" : "#ff3b8f"} fontSize="10" className="num">
        {last.close}
      </text>
    </svg>
  );
}

export function ScatterTape({ dots }: { dots: TapeDot[] }) {
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
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full">
      <line x1={28} x2={w - 28} y1={h / 2} y2={h / 2} stroke="rgba(255,255,255,0.05)" />
      <line x1={w / 2} x2={w / 2} y1={16} y2={h - 16} stroke="rgba(255,255,255,0.05)" />
      {dots.map((d) => {
        const up = d.change24h >= 0;
        const color = up ? "#3ee8a8" : "#ff3b8f";
        return (
          <g key={d.mint}>
            <circle cx={sx(d.score)} cy={sy(d.change24h)} r={r(d.liquidityUsd) + 7} fill={color} opacity="0.1" />
            <circle cx={sx(d.score)} cy={sy(d.change24h)} r={r(d.liquidityUsd)} fill={color} opacity="0.88" />
            <text x={sx(d.score) + 9} y={sy(d.change24h) - 8} className="num" fill="#b8b0c8" fontSize="10">
              {d.symbol}
            </text>
            <title>
              {d.symbol} · score {d.score.toFixed(1)} · {d.change24h.toFixed(2)}%
            </title>
          </g>
        );
      })}
    </svg>
  );
}

export function EquityPath({ values }: { values: number[] }) {
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
  const stroke = up ? "#3ee8a8" : "#ff3b8f";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full">
      <defs>
        <linearGradient id="eqFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon fill="url(#eqFill)" points={area} />
      <polyline fill="none" stroke={stroke} strokeWidth="2.2" strokeLinejoin="round" points={line} />
    </svg>
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
            fill={up ? "#ff4ad8" : "#3ee8a8"}
            opacity="0.88"
          />
        );
      })}
    </svg>
  );
}

function EmptyPlot({ label }: { label: string }) {
  return (
    <div className="grid h-full min-h-[88px] place-items-center px-3 text-center text-[11px] uppercase tracking-[0.18em] text-[var(--faint)]">
      {label}
    </div>
  );
}
