"use client";

import { useState, useRef, useCallback } from "react";

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

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Inline-SVG area chart with metric toggle and hover tooltip. No charting dependency. */
export function AreaChart({ series }: { series: SeriesPoint[] }) {
  const [metric, setMetric] = useState<Metric>("tokens");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const W = 1000;
  const H = 240;
  const padX = 8;
  const padY = 16;

  const vals = series.map((p) => valueOf(p, metric));
  const max = Math.max(1, ...vals);
  const n = series.length;

  const xPos = (i: number) => (n <= 1 ? padX : padX + (i / (n - 1)) * (W - padX * 2));
  const yPos = (v: number) => H - padY - (v / max) * (H - padY * 2);

  const line = vals.map((v, i) => `${i === 0 ? "M" : "L"}${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`).join(" ");
  const area = `${line} L${xPos(n - 1).toFixed(1)},${H - padY} L${xPos(0).toFixed(1)},${H - padY} Z`;

  const peak = vals.length ? vals.indexOf(Math.max(...vals)) : -1;
  const total = vals.reduce((a, b) => a + b, 0);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (n <= 1 || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const idx = Math.round(relX * (n - 1));
      setHoverIdx(Math.max(0, Math.min(n - 1, idx)));
    },
    [n],
  );

  const handleMouseLeave = useCallback(() => setHoverIdx(null), []);

  const hp = hoverIdx !== null ? series[hoverIdx] : null;

  return (
    <div className="overflow-hidden rounded-brand-lg card">
      <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-semibold text-text">Over time</span>
          <span className="tnum text-[13px] text-text-subtle">{fmtVal(total, metric)} total</span>
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

      <div className="relative px-2 py-3">
        {n === 0 || total === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-[13px] text-text-muted">
            No activity in this range.
          </div>
        ) : n === 1 ? (
          <div className="flex h-[200px] items-center justify-center text-[13px] text-text-muted">
            Just started — {fmtVal(total, metric)} {metric} so far. More data needed for a chart.
          </div>
        ) : (
          <>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className="h-[200px] w-full cursor-crosshair"
              preserveAspectRatio="none"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              <defs>
                <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={area} fill="url(#areaFill)" />
              <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              {peak >= 0 && hoverIdx === null && (
                <circle cx={xPos(peak)} cy={yPos(vals[peak]!)} r="3" fill="var(--color-accent)" vectorEffect="non-scaling-stroke" />
              )}
              {hoverIdx !== null && (
                <>
                  <line
                    x1={xPos(hoverIdx)}
                    y1={padY}
                    x2={xPos(hoverIdx)}
                    y2={H - padY}
                    stroke="var(--color-accent)"
                    strokeWidth="1"
                    strokeDasharray="4 3"
                    vectorEffect="non-scaling-stroke"
                    opacity="0.5"
                  />
                  <circle
                    cx={xPos(hoverIdx)}
                    cy={yPos(vals[hoverIdx]!)}
                    r="4"
                    fill="var(--color-accent)"
                    stroke="var(--color-bg)"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                </>
              )}
            </svg>
            {hoverIdx !== null && hp && (
              <div
                className="pointer-events-none absolute top-2 z-10 rounded-lg border border-accent/20 bg-bg/95 px-3.5 py-2.5 shadow-xl"
                style={{ left: `${Math.min(85, Math.max(5, (hoverIdx / (n - 1)) * 100))}%`, transform: "translateX(-50%)" }}
              >
                <div className="text-[12px] font-medium text-text">{fmtDate(hp.ts)}</div>
                <div className="mt-1 flex flex-col gap-1 tnum">
                  <span className="text-[15px] font-bold text-text">{fmtVal(valueOf(hp, metric), metric)} <span className="text-text-muted text-[12px] font-normal">{metric}</span></span>
                  {metric === "tokens" && (
                    <span className="text-[12px] text-text-muted">in: {fmtVal(hp.tokens_in, "tokens")} · out: {fmtVal(hp.tokens_out, "tokens")}</span>
                  )}
                  <span className="text-[12px] text-text-muted">{hp.requests} req · ${hp.cost.toFixed(4)}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {n > 0 && total > 0 && peak >= 0 && (
        <div className="flex justify-between border-t border-border-subtle px-4 py-2 tnum text-[12px] text-text-subtle">
          <span>{fmtTime(series[0]!.ts)}</span>
          <span className="font-medium">
            peak {fmtVal(vals[peak]!, metric)} @ {fmtTime(series[peak]!.ts)}
          </span>
          <span>{fmtTime(series[n - 1]!.ts)}</span>
        </div>
      )}
    </div>
  );
}
