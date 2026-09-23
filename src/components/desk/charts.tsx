import type { Candle, TapeDot } from "@/lib/types";

export function CandleChart({ candles }: { candles: Candle[] }) {
  if (candles.length < 2) {
    return <EmptyPlot label="No live OHLCV for this pool" />;
  }
  const w = 520;
  const h = 168;
  const pad = 8;
  const slice = candles.slice(-72);
  const highs = slice.map((c) => c.high);
  const lows = slice.map((c) => c.low);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = max - min || 1;
  const bw = Math.max(2, (w - pad * 2) / slice.length - 1.2);
  const y = (v: number) => pad + ((max - v) / span) * (h - pad * 2);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full">
      {slice.map((c, i) => {
        const x = pad + (i + 0.5) * ((w - pad * 2) / slice.length);
        const up = c.close >= c.open;
        const color = up ? "#3ee8a8" : "#ff3b8f";
        return (
          <g key={`${c.time}-${i}`}>
            <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth="1" />
            <rect
              x={x - bw / 2}
              y={y(Math.max(c.open, c.close))}
              width={bw}
              height={Math.max(1, Math.abs(y(c.open) - y(c.close)))}
              fill={color}
            />
          </g>
        );
      })}
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
  const sx = (s: number) => 24 + ((s - minS) / (maxS - minS || 1)) * (w - 48);
  const sy = (c: number) => 20 + (1 - (c - minC) / (maxC - minC || 1)) * (h - 40);
  const r = (liq: number) => Math.min(16, 3 + Math.sqrt(Math.max(liq, 0)) / 180);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full">
      {dots.map((d) => {
        const up = d.change24h >= 0;
        const color = up ? "#3ee8a8" : "#ff3b8f";
        return (
          <g key={d.mint}>
            <circle cx={sx(d.score)} cy={sy(d.change24h)} r={r(d.liquidityUsd) + 6} fill={color} opacity="0.12" />
            <circle cx={sx(d.score)} cy={sy(d.change24h)} r={r(d.liquidityUsd)} fill={color} opacity="0.85" />
            <text x={sx(d.score) + 8} y={sy(d.change24h) - 8} className="num" fill="#8b94a7" fontSize="9">
              {d.symbol}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function EquityPath({ values }: { values: number[] }) {
  if (values.length < 2) return <EmptyPlot label="No live equity prints yet" />;
  const w = 360;
  const h = 110;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (w - 8) + 4;
      const y = h - 6 - ((v - min) / span) * (h - 14);
      return `${x},${y}`;
    })
    .join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full">
      <polyline fill="none" stroke={up ? "#3ee8a8" : "#ff3b8f"} strokeWidth="2" points={pts} />
    </svg>
  );
}

export function VolumeBars({ candles }: { candles: Candle[] }) {
  const slice = candles.slice(-36);
  if (slice.length === 0) return <EmptyPlot label="No live volume bars" />;
  const w = 360;
  const h = 110;
  const max = Math.max(...slice.map((c) => c.volume), 1);
  const bw = Math.max(2, (w - 8) / slice.length - 1);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full">
      {slice.map((c, i) => {
        const x = 4 + i * ((w - 8) / slice.length);
        const bh = (c.volume / max) * (h - 10);
        const up = c.close >= c.open;
        return (
          <rect
            key={`${c.time}-${i}`}
            x={x}
            y={h - 4 - bh}
            width={bw}
            height={Math.max(1, bh)}
            fill={up ? "#ff4ad8" : "#3ee8a8"}
            opacity="0.85"
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
