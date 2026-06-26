"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Lamp } from "@/components/Lamp";
import { Badge } from "@/components/Badge";
import { Icon } from "@/components/Icon";
import { fmt } from "@/components/ui";
import type { UsageLog } from "@/lib/gateway";

type StatusFilter = "all" | "ok" | "error";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ok", label: "Success" },
  { key: "error", label: "Errors" },
];

// shared control style for the filter row — bordered surface chip, accent on focus.
const ctrl = "h-9 rounded-brand border border-border bg-surface-2 px-2.5 text-[12.5px] text-text focus:border-accent focus:outline-none";

// recency presets for the request log (a live 200-row buffer, so relative
// windows fit better than absolute dates). null = no time filter.
const SINCE_PRESETS: { label: string; ms: number | null }[] = [
  { label: "1h", ms: 3600_000 },
  { label: "6h", ms: 6 * 3600_000 },
  { label: "24h", ms: 24 * 3600_000 },
  { label: "7d", ms: 7 * 86400_000 },
  { label: "All", ms: null },
];
const sincePill = (active: boolean): string =>
  `rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors ${
    active ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text"
  }`;

export function LogTable({ logs: initial }: { logs: UsageLog[] }) {
  const [logs, setLogs] = useState(initial);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [provFilter, setProvFilter] = useState<string>("all");
  const [sinceMs, setSinceMs] = useState<number | null>(null);
  const [live, setLive] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/gw/admin/logs?limit=200");
      if (res.ok) {
        const data = (await res.json()) as { logs: UsageLog[] };
        setLogs(data.logs);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (live) {
      timer.current = setInterval(refresh, 5000);
      return () => { if (timer.current) clearInterval(timer.current); };
    }
    if (timer.current) clearInterval(timer.current);
  }, [live, refresh]);

  const providers = [...new Set(logs.map((l) => l.provider))].sort();

  const okCount = logs.filter((l) => l.status >= 200 && l.status < 300).length;
  const errCount = logs.length - okCount;

  const sinceFloor = sinceMs !== null ? Date.now() - sinceMs : null;

  const shown = logs.filter((l) => {
    if (filter === "ok" && !(l.status >= 200 && l.status < 300)) return false;
    if (filter === "error" && l.status >= 200 && l.status < 300) return false;
    if (provFilter !== "all" && l.provider !== provFilter) return false;
    if (sinceFloor !== null && l.ts < sinceFloor) return false;
    return true;
  });

  const hasFilters = filter !== "all" || provFilter !== "all" || sinceMs !== null;
  const clearFilters = () => { setFilter("all"); setProvFilter("all"); setSinceMs(null); };

  const count = (k: StatusFilter) => (k === "all" ? logs.length : k === "ok" ? okCount : errCount);

  return (
    <div className="overflow-hidden rounded-brand-lg border border-border bg-surface shadow-soft">
      <header className="flex flex-col gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCollapsed((v) => !v)}
              className="flex-none rounded p-0.5 text-text-subtle transition-colors hover:text-text"
              aria-label={collapsed ? "Expand requests" : "Collapse requests"}
              title={collapsed ? "Expand" : "Collapse"}
            >
              <Icon name={collapsed ? "chevron_right" : "expand_more"} size={18} />
            </button>
            <div className="flex items-center gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    filter === f.key ? "bg-surface-2 text-text" : "text-text-muted hover:text-text"
                  }`}
                >
                  {f.label}
                  <span className="tnum text-text-subtle">{count(f.key)}</span>
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => setLive((v) => !v)}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              live ? "bg-success/15 text-success" : "text-text-muted hover:text-text"
            }`}
            title={live ? "Auto-refresh ON (5s)" : "Auto-refresh OFF"}
          >
            <Icon name={live ? "radio_button_checked" : "radio_button_unchecked"} size={12} />
            Live
          </button>
        </div>

        {!collapsed && (
          <div className="flex flex-wrap items-end gap-2.5">
            <FilterField label="Provider">
              <select
                value={provFilter}
                onChange={(e) => setProvFilter(e.target.value)}
                className={ctrl + " w-40"}
              >
                <option value="all">All providers</option>
                {providers.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Since">
              <div className="flex h-9 items-center gap-0.5 rounded-brand border border-border bg-surface-2 px-1">
                {SINCE_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setSinceMs(p.ms)}
                    className={sincePill(sinceMs === p.ms)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </FilterField>
            <button
              onClick={clearFilters}
              disabled={!hasFilters}
              className="flex h-9 items-center gap-1.5 rounded-brand border border-border bg-surface-2 px-3 text-[12.5px] font-medium text-text-muted transition-colors hover:border-text-subtle hover:text-text disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-muted"
              title={hasFilters ? "Reset all filters" : "No filters applied"}
            >
              <Icon name="filter_alt_off" size={15} />
              Clear
            </button>
          </div>
        )}
      </header>

      {collapsed ? null : shown.length === 0 ? (
        <div className="px-4 py-8 text-center text-[13px] text-text-muted">
          {logs.length === 0 ? "No requests recorded yet." : "No requests match this filter."}
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="text-text-subtle">
                  {["Status", "Time", "Alias", "Provider", "Model", "In", "Out", "ms", "Mode"].map((h, i) => (
                    <th
                      key={h + i}
                      className={`whitespace-nowrap px-4 pb-2.5 pt-3 text-[10px] font-medium uppercase tracking-wider ${
                        i >= 5 && i <= 7 ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((l, i) => {
                  const ok = l.status >= 200 && l.status < 300;
                  const isExpanded = expandedIdx === i;
                  return (
                    <tr key={i} onClick={() => setExpandedIdx(isExpanded ? null : i)} className={`border-t border-border-subtle cursor-pointer transition-colors ${isExpanded ? "bg-surface-2/60" : "hover:bg-surface-2/70"}`}>
                      <Td>
                        <Badge tone={ok ? "live" : "down"}>
                          <Lamp state={ok ? "live" : "down"} />
                          {l.status}
                        </Badge>
                      </Td>
                      <Td muted title={fmt.time(l.ts)} suppressHydrationWarning>
                        {fmt.ago(l.ts)} ago
                      </Td>
                      <Td className="text-text">{l.alias}</Td>
                      <Td muted>{l.provider}</Td>
                      <Td muted>{l.model}</Td>
                      <Td right>{fmt.int(l.tokens_in)}</Td>
                      <Td right>{fmt.int(l.tokens_out)}</Td>
                      <Td right>{fmt.int(l.latency_ms)}</Td>
                      <Td muted>{l.stream ? "stream" : "unary"}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {expandedIdx !== null && shown[expandedIdx] && (
            <RequestDetail log={shown[expandedIdx]} onClose={() => setExpandedIdx(null)} />
          )}
        </>
      )}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-text-subtle">{label}</span>
      {children}
    </label>
  );
}

function Td({
  children,
  muted,
  right,
  title,
  className,
  suppressHydrationWarning,
}: {
  children: React.ReactNode;
  muted?: boolean;
  right?: boolean;
  title?: string;
  className?: string;
  suppressHydrationWarning?: boolean;
}) {
  return (
    <td
      title={title}
      suppressHydrationWarning={suppressHydrationWarning}
      className={`whitespace-nowrap px-4 py-2.5 tnum text-[12.5px] ${right ? "text-right" : "text-left"} ${
        muted ? "text-text-muted" : "text-text"
      }${className ? ` ${className}` : ""}`}
    >
      {children}
    </td>
  );
}

function RequestDetail({ log, onClose }: { log: UsageLog; onClose: () => void }) {
  const ok = log.status >= 200 && log.status < 300;
  const totalTokens = log.tokens_in + log.tokens_out;

  return (
    <div className="border-t border-border-subtle bg-surface-2/40 px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-text">Request Details</span>
        <button onClick={onClose} className="text-text-subtle hover:text-text">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-[12px] sm:grid-cols-4">
        <DetailCell label="Status" value={`${log.status} ${ok ? "OK" : "Error"}`} />
        <DetailCell label="Timestamp" value={new Date(log.ts).toLocaleString()} />
        <DetailCell label="Alias" value={log.alias} />
        <DetailCell label="Provider" value={log.provider} />
        <DetailCell label="Model" value={log.model} />
        <DetailCell label="Mode" value={log.stream ? "Streaming" : "Unary"} />
        <DetailCell label="Latency" value={`${log.latency_ms}ms`} />
        <DetailCell label="Cost" value={fmt.cost(log.cost)} />
        <DetailCell label="Input tokens" value={fmt.int(log.tokens_in)} />
        <DetailCell label="Output tokens" value={fmt.int(log.tokens_out)} />
        <DetailCell label="Cached tokens" value={fmt.int(log.cached_tokens)} />
        <DetailCell label="Total tokens" value={fmt.int(totalTokens)} />
      </div>
    </div>
  );
}

function DetailCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wider text-text-subtle">{label}</span>
      <div className="tnum text-text">{value}</div>
    </div>
  );
}
