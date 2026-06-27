"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Lamp } from "@/components/Lamp";
import { Badge } from "@/components/Badge";
import { Icon } from "@/components/Icon";
import { fmt } from "@/components/ui";
import { adminApi } from "@/lib/client";
import type { UsageLog } from "@/lib/gateway";

type StatusFilter = "all" | "ok" | "error";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ok", label: "Success" },
  { key: "error", label: "Errors" },
];

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

interface KeyInfo { fingerprint: string; name: string }

export function LogTable({ logs: initial }: { logs: UsageLog[] }) {
  const [logs, setLogs] = useState(initial);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [provFilter, setProvFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [keyFilter, setKeyFilter] = useState<string>("all");
  const [sinceMs, setSinceMs] = useState<number | null>(null);
  const [live, setLive] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [allProviders, setAllProviders] = useState<string[]>([]);
  const [allModels, setAllModels] = useState<string[]>([]);
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
    adminApi.keys().then((r) => { if (r.ok && r.data) setKeys(r.data); });
    adminApi.models().then((r) => {
      if (r.ok && r.data) {
        setAllProviders(r.data.providers.map((p) => p.id).sort());
        const m = r.data.providers.flatMap((p) => p.models.map((m) => m.id));
        setAllModels([...new Set(m)].sort());
      }
    });
  }, []);

  useEffect(() => {
    if (live) {
      timer.current = setInterval(refresh, 5000);
      return () => { if (timer.current) clearInterval(timer.current); };
    }
    if (timer.current) clearInterval(timer.current);
  }, [live, refresh]);

  const providers = allProviders.length > 0 ? allProviders : [...new Set(logs.map((l) => l.provider))].sort();
  const models = allModels.length > 0 ? allModels : [...new Set(logs.map((l) => l.alias || l.model))].sort();

  const keyOptions = keys.map((k) => ({ value: k.fingerprint, label: k.name }));

  const okCount = logs.filter((l) => l.status >= 200 && l.status < 300).length;
  const errCount = logs.length - okCount;

  const sinceFloor = sinceMs !== null ? Date.now() - sinceMs : null;

  const shown = logs.filter((l) => {
    if (filter === "ok" && !(l.status >= 200 && l.status < 300)) return false;
    if (filter === "error" && l.status >= 200 && l.status < 300) return false;
    if (provFilter !== "all" && l.provider !== provFilter) return false;
    if (modelFilter !== "all" && l.alias !== modelFilter && l.model !== modelFilter) return false;
    if (keyFilter !== "all" && l.client_key !== keyFilter) return false;
    if (sinceFloor !== null && l.ts < sinceFloor) return false;
    return true;
  });

  const hasFilters = filter !== "all" || provFilter !== "all" || modelFilter !== "all" || keyFilter !== "all" || sinceMs !== null;
  const clearFilters = () => { setFilter("all"); setProvFilter("all"); setModelFilter("all"); setKeyFilter("all"); setSinceMs(null); };

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
          <div className="flex flex-wrap items-center gap-2">
            <FilterPill
              label="Access Key"
              value={keyFilter}
              options={[{ value: "all", label: "All keys" }, ...keyOptions]}
              onChange={setKeyFilter}
            />
            <FilterPill
              label="Provider"
              value={provFilter}
              options={[{ value: "all", label: "All providers" }, ...providers.map((p) => ({ value: p, label: p }))]}
              onChange={setProvFilter}
            />
            <FilterPill
              label="Model"
              value={modelFilter}
              options={[{ value: "all", label: "All models" }, ...models.map((m) => ({ value: m, label: m }))]}
              onChange={setModelFilter}
            />
            <div className="flex h-8 items-center gap-0.5 rounded-full border border-border bg-surface-2 px-1">
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
            <button
              onClick={clearFilters}
              disabled={!hasFilters}
              className="flex h-8 items-center gap-1 rounded-full border border-border bg-surface-2 px-3 text-[12px] font-medium text-text-muted transition-colors hover:border-text-subtle hover:text-text disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-muted"
              title={hasFilters ? "Reset all filters" : "No filters applied"}
            >
              <Icon name="filter_alt_off" size={14} />
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
                      className={`whitespace-nowrap px-4 pb-2.5 pt-3 text-[11px] font-medium uppercase tracking-wider ${
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

function FilterPill({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const active = value !== "all";

  useEffect(() => { if (open) setSearch(""); }, [open]);

  const display = active ? options.find((o) => o.value === value)?.label ?? label : label;
  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors ${
          active
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-border bg-surface-2 text-text-muted hover:border-text-subtle hover:text-text"
        }`}
      >
        {display}
        <Icon name="expand_more" size={14} />
      </button>
      {open && createPortal(
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6" onClick={() => setOpen(false)}>
          <div
            className="flex max-h-[60vh] w-full max-w-[360px] flex-col overflow-hidden rounded-brand-lg border border-border bg-surface shadow-elevated"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
              <span className="text-[14px] font-semibold text-text">{label}</span>
              <button onClick={() => setOpen(false)} className="text-text-subtle hover:text-text" aria-label="Close">
                <Icon name="close" size={18} />
              </button>
            </header>

            {options.length > 6 && (
              <div className="border-b border-border-subtle px-4 py-2.5">
                <div className="flex items-center gap-2 rounded-brand border border-border bg-surface-2 px-2.5 py-1.5">
                  <Icon name="search" size={15} className="text-text-subtle" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={`Search ${label.toLowerCase()}…`}
                    autoFocus
                    className="flex-1 bg-transparent text-[13px] text-text placeholder:text-text-subtle outline-none"
                  />
                  {search && (
                    <button onClick={() => setSearch("")} className="text-text-subtle hover:text-text">
                      <Icon name="close" size={14} />
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-4 py-6 text-center text-[13px] text-text-muted">No matches.</div>
              ) : (
                filtered.map((o) => (
                  <button
                    key={o.value}
                    onClick={() => { onChange(o.value); setOpen(false); }}
                    className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13px] transition-colors ${
                      value === o.value ? "bg-accent/10 text-accent" : "text-text-muted hover:bg-surface-2 hover:text-text"
                    }`}
                  >
                    {value === o.value && <Icon name="check" size={14} />}
                    <span className={`truncate ${value === o.value ? "" : "pl-[22px]"}`}>{o.label}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
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
      className={`whitespace-nowrap px-4 py-2.5 tnum text-[13px] ${right ? "text-right" : "text-left"} ${
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
      <span className="text-[11px] uppercase tracking-wider text-text-subtle">{label}</span>
      <div className="tnum text-text">{value}</div>
    </div>
  );
}
