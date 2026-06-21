"use client";

import { useState } from "react";

export interface SeriesPoint {
  ts: number;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  cost: number;
}

type Metric = "tokens" | "cost" | "requests";

const METRICS: { key: Metric; label: string }[] = [
  { key: "tokens", label: "Tokens" },
  { key: "cost", label: "Cost" },
  { key: "requests", label: "Requests" },
];

function valueOf(p: SeriesPoint, m: Metric): number {
  if (m === "tokens") return p.tokens_in + p.tokens_out;
  if (m === "cost") return p.cost;
  return p.requests;
}

function fmtVal(v: number, m: Metric): string {
  if (m === "cost") return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(Math.round(v));
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Inline-SVG area chart with a metric toggle. No charting dependency. */
export function AreaChart({ series }: { series: SeriesPoint[] }) {
  const [metric, setMetric] = useState<Metric>("tokens");

  const W = 1000;
  const H = 240;
  const padX = 8;
  const padY = 16;

  const vals = series.map((p) => valueOf(p, metric));
  const max = Math.max(1, ...vals);
  const n = series.length;

  const x = (i: number) => (n <= 1 ? padX : padX + (i / (n - 1)) * (W - padX * 2));
  const y = (v: number) => H - padY - (v / max) * (H - padY * 2);

  const line = vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${H - padY} L${x(0).toFixed(1)},${H - padY} Z`;

  const peak = vals.length ? vals.indexOf(Math.max(...vals)) : -1;
  const total = vals.reduce((a, b) => a + b, 0);

  return (
    <div className="overflow-hidden rounded-brand-lg border border-border bg-surface shadow-soft">
      <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-semibold text-text">Over time</span>
          <span className="tnum text-[12px] text-text-muted">{fmtVal(total, metric)} total</span>
        </div>
        <div className="flex items-center gap-1">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                metric === m.key ? "bg-surface-2 text-text" : "text-text-muted hover:text-text"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </header>

      <div className="px-2 py-3">
        {n === 0 || total === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-[13px] text-text-muted">
            No activity in this range.
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="h-[200px] w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={area} fill="url(#areaFill)" />
            <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            {peak >= 0 && (
              <circle cx={x(peak)} cy={y(vals[peak]!)} r="3" fill="var(--color-accent)" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
        )}
      </div>

      {n > 0 && total > 0 && peak >= 0 && (
        <div className="flex justify-between border-t border-border-subtle px-4 py-2 tnum text-[10px] text-text-subtle">
          <span>{fmtTime(series[0]!.ts)}</span>
          <span>
            peak {fmtVal(vals[peak]!, metric)} @ {fmtTime(series[peak]!.ts)}
          </span>
          <span>{fmtTime(series[n - 1]!.ts)}</span>
        </div>
      )}
    </div>
  );
}
