"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { AreaChart, type SeriesPoint } from "@/components/AreaChart";
import { Stat, fmt, Empty } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { RichCard } from "@/components/RichCard";
import type { UsageSummary } from "@/lib/gateway";

type Window = { label: string; key: "today" | "24h" | "7d" | "30d" | "60d"; bucketMs: number };

// window -> chart bucket size. Buckets keep ~24-60 points per range.
const WINDOWS: Window[] = [
  { label: "Today", key: "today", bucketMs: 15 * 60_000 },
  { label: "24H", key: "24h", bucketMs: 3600_000 },
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
                win.label === w.label ? "bg-accent text-accent-ink" : "text-text-muted hover:text-text"
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
                  key={win.key}
                  rows={summary.by_provider.map((p) => ({ label: p.provider, ...p }))}
                  loading={loading}
                  firstCol="Provider"
                />
              ) : (
                <Empty>No usage in this window.</Empty>
              )}
            </RichCard>
            <RichCard header={<span className="text-[13px] font-semibold text-text">By model</span>}>
              {summary?.by_model.length ? (
                <BreakdownTable
                  key={win.key}
                  rows={summary.by_model.map((m) => ({ label: `${m.alias} → ${m.model}`, ...m }))}
                  loading={loading}
                  firstCol="Model"
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

const PAGE_SIZE = 8;

function BreakdownTable({
  rows,
  loading,
  firstCol,
}: {
  rows: Array<{ label: string; requests: number; tokens_in: number; tokens_out: number; cost: number }>;
  loading: boolean;
  firstCol: string;
}) {
  const [page, setPage] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [minH, setMinH] = useState(0);
  const totalPages = Math.ceil(rows.length / PAGE_SIZE);
  const paged = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    if (wrapRef.current && paged.length === PAGE_SIZE) {
      const h = wrapRef.current.offsetHeight;
      if (h > minH) setMinH(h);
    }
  }, [paged, minH]);

  return (
    <div className={loading ? "opacity-50" : ""}>
      <div ref={wrapRef} className="table-wrap" style={minH ? { minHeight: minH } : undefined}>
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-text-subtle">
              <th className="pb-2 text-left text-[11px] font-medium uppercase tracking-wider">{firstCol}</th>
              {["Reqs", "In", "Out", "Cost"].map((h, i) => (
                <th
                  key={h + i}
                  className="pb-2 text-right text-[11px] font-medium uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((r) => (
              <tr key={r.label} className="border-t border-border-subtle">
                <td className="max-w-[180px] truncate py-2 text-[13px] text-text" title={r.label}>{r.label}</td>
                <td className="py-2 text-right tnum text-[13px] text-text-muted">{fmt.int(r.requests)}</td>
                <td className="py-2 text-right tnum text-[13px] text-text-muted">{fmt.compact(r.tokens_in)}</td>
                <td className="py-2 text-right tnum text-[13px] text-text-muted">{fmt.compact(r.tokens_out)}</td>
                <td className="py-2 text-right tnum text-[13px] text-text">{fmt.cost(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-3">
          <span className="text-[11px] text-text-subtle">{rows.length} total</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex h-7 w-7 items-center justify-center rounded-brand border border-border text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-30"
              aria-label="Previous page"
            >
              <Icon name="chevron_left" size={16} />
            </button>
            <span className="tnum px-1 text-[11px] text-text-muted">{page + 1}/{totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="flex h-7 w-7 items-center justify-center rounded-brand border border-border text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-30"
              aria-label="Next page"
            >
              <Icon name="chevron_right" size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
