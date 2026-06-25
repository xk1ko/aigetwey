"use client";

import { useEffect, useState, useCallback } from "react";
import { AreaChart, type SeriesPoint } from "@/components/AreaChart";
import { Stat, fmt, Empty } from "@/components/ui";
import { RichCard } from "@/components/RichCard";
import type { UsageSummary } from "@/lib/gateway";

type Window = { label: string; key: "today" | "24h" | "7d" | "30d" | "60d"; bucketMs: number };

// window -> chart bucket size. Buckets keep ~24-60 points per range.
const WINDOWS: Window[] = [
  { label: "Today", key: "today", bucketMs: 3600_000 },
  { label: "24h", key: "24h", bucketMs: 3600_000 },
  { label: "7D", key: "7d", bucketMs: 6 * 3600_000 },
  { label: "30D", key: "30d", bucketMs: 86400_000 },
  { label: "60D", key: "60d", bucketMs: 2 * 86400_000 },
];

/** Lookback start (ms epoch) for a window. "Today" is since local midnight; the
 *  rest are rolling lookbacks from now. */
function sinceFor(key: Window["key"]): number {
  const now = Date.now();
  switch (key) {
    case "today": {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    case "24h": return now - 24 * 3600_000;
    case "7d": return now - 7 * 86400_000;
    case "30d": return now - 30 * 86400_000;
    case "60d": return now - 60 * 86400_000;
  }
}

export function UsageView() {
  const [win, setWin] = useState<Window>(WINDOWS[0]!);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (w: Window) => {
    setLoading(true);
    setError("");
    const since = sinceFor(w.key);
    const [sumRes, serRes] = await Promise.all([
      fetch(`/api/gw/admin/usage?since=${since}`),
      fetch(`/api/gw/admin/usage/series?since=${since}&bucket=${w.bucketMs}`),
    ]);
    if (!sumRes.ok) {
      setError("could not load usage");
      setLoading(false);
      return;
    }
    setSummary((await sumRes.json()) as UsageSummary);
    const ser = serRes.ok ? ((await serRes.json()) as { series: SeriesPoint[] }) : { series: [] };
    setSeries(ser.series);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(win);
  }, [win, load]);

  const total = summary?.total;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-text">Usage</h1>
          <p className="mt-1 text-[13px] text-text-muted">Tokens and cost across providers and models.</p>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border bg-surface p-1">
          {WINDOWS.map((w) => (
            <button
              key={w.label}
              onClick={() => setWin(w)}
              className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                win.label === w.label ? "bg-surface-2 text-text" : "text-text-muted hover:text-text"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <Empty>{error}</Empty>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Requests" value={fmt.int(total?.requests ?? 0)} />
            <Stat label="Tokens in" value={fmt.compact(total?.tokens_in ?? 0)} />
            <Stat label="Tokens out" value={fmt.compact(total?.tokens_out ?? 0)} />
            <Stat label="Cost" value={fmt.cost(total?.cost ?? 0)} />
          </div>

          <div className="mb-5">
            <AreaChart series={series} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <RichCard header={<span className="text-[13px] font-semibold text-text">By provider</span>}>
              {summary?.by_provider.length ? (
                <BreakdownTable
                  rows={summary.by_provider.map((p) => ({ label: p.provider, ...p }))}
                  loading={loading}
                />
              ) : (
                <Empty>No usage in this window.</Empty>
              )}
            </RichCard>
            <RichCard header={<span className="text-[13px] font-semibold text-text">By model</span>}>
              {summary?.by_model.length ? (
                <BreakdownTable
                  rows={summary.by_model.map((m) => ({ label: `${m.alias} → ${m.model}`, ...m }))}
                  loading={loading}
                />
              ) : (
                <Empty>No usage in this window.</Empty>
              )}
            </RichCard>
          </div>
        </>
      )}
    </div>
  );
}

function BreakdownTable({
  rows,
  loading,
}: {
  rows: Array<{ label: string; requests: number; tokens_in: number; tokens_out: number; cost: number }>;
  loading: boolean;
}) {
  return (
    <div className={`table-wrap ${loading ? "opacity-50" : ""}`}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-text-subtle">
            {["", "Reqs", "In", "Out", "Cost"].map((h, i) => (
              <th
                key={h + i}
                className={`pb-2 text-[10px] font-medium uppercase tracking-wider ${i === 0 ? "text-left" : "text-right"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-border-subtle">
              <td className="py-2 text-[12.5px] text-text">{r.label}</td>
              <td className="py-2 text-right tnum text-[12.5px] text-text-muted">{fmt.int(r.requests)}</td>
              <td className="py-2 text-right tnum text-[12.5px] text-text-muted">{fmt.compact(r.tokens_in)}</td>
              <td className="py-2 text-right tnum text-[12.5px] text-text-muted">{fmt.compact(r.tokens_out)}</td>
              <td className="py-2 text-right tnum text-[12.5px] text-text">{fmt.cost(r.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
