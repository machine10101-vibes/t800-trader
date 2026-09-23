import { pct, priceFmt, usd } from "@/lib/utils";

export function Tone({ value, children }: { value: number | null | undefined; children?: React.ReactNode }) {
  const n = value ?? 0;
  const cls = n > 0 ? "pos" : n < 0 ? "neg" : "text-[var(--muted)]";
  return <span className={`num ${cls}`}>{children ?? pct(value)}</span>;
}

export function Pill({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "mint" | "crimson" | "amber" | "ice";
}) {
  const map = {
    default: "border-[var(--line)] text-[var(--muted)]",
    mint: "border-[rgba(62,232,168,0.28)] text-[var(--mint)] bg-[rgba(62,232,168,0.06)]",
    crimson: "border-[rgba(255,59,74,0.28)] text-[var(--crimson)] bg-[rgba(255,59,74,0.06)]",
    amber: "border-[rgba(243,193,91,0.28)] text-[var(--amber)] bg-[rgba(243,193,91,0.08)]",
    ice: "border-[rgba(121,212,255,0.28)] text-[var(--ice)] bg-[rgba(121,212,255,0.06)]",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] tracking-wide ${map[tone]}`}>
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "mint" | "crimson" | "amber";
}) {
  const color =
    tone === "mint" ? "text-[var(--mint)]" : tone === "crimson" ? "text-[var(--crimson)]" : tone === "amber" ? "text-[var(--amber)]" : "";
  return (
    <div className="glass hairline rounded-2xl p-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--faint)]">{label}</div>
      <div className={`mt-2 text-2xl num ${color}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-[var(--muted)]">{sub}</div> : null}
    </div>
  );
}

export function ScoreRing({ score }: { score: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const dash = (score / 100) * c;
  const color = score >= 70 ? "var(--mint)" : score >= 55 ? "var(--amber)" : "var(--crimson)";
  return (
    <div className="relative h-16 w-16">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={`${dash} ${c - dash}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center num text-sm">{score.toFixed(0)}</div>
    </div>
  );
}

export function Spark({ values, up }: { values: number[]; up?: boolean }) {
  if (values.length < 2) return <div className="h-8 w-24" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 120;
  const h = 36;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  const color = up === false || (up === undefined && values[values.length - 1] < values[0]) ? "#ff3b4a" : "#3ee8a8";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-28">
      <polyline fill="none" stroke={color} strokeWidth="2" points={pts} />
    </svg>
  );
}

export function Money({ n, digits = 2 }: { n: number | null | undefined; digits?: number }) {
  return <span className="num">{usd(n, digits)}</span>;
}

export function Px({ n }: { n: number | null | undefined }) {
  return <span className="num">{priceFmt(n)}</span>;
}

export function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-[var(--faint)]">{children}</div>;
}
