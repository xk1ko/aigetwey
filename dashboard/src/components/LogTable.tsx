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

export function LogTable({ logs: initial }: { logs: UsageLog[] }) {
  const [logs, setLogs] = useState(initial);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [provFilter, setProvFilter] = useState<string>("all");
  const [live, setLive] = useState(true);
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

  const shown = logs.filter((l) => {
    if (filter === "ok" && !(l.status >= 200 && l.status < 300)) return false;
    if (filter === "error" && l.status >= 200 && l.status < 300) return false;
    if (provFilter !== "all" && l.provider !== provFilter) return false;
    return true;
  });

  const count = (k: StatusFilter) => (k === "all" ? logs.length : k === "ok" ? okCount : errCount);

  return (
    <div className="overflow-hidden rounded-brand-lg border border-border bg-surface shadow-soft">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
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
        <div className="flex items-center gap-2">
          {providers.length > 1 && (
            <select
              value={provFilter}
              onChange={(e) => setProvFilter(e.target.value)}
              className="rounded border border-border-subtle bg-transparent px-2 py-1 text-[11px] text-text-muted focus:border-accent focus:outline-none"
            >
              <option value="all">All providers</option>
              {providers.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
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
      </header>

      {shown.length === 0 ? (
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
                    <tr key={i} onClick={() => setExpandedIdx(isExpanded ? null : i)} className={`border-t border-border-subtle cursor-pointer transition-colors ${isExpanded ? "bg-surface-2/60" : "hover:bg-surface-2/40"}`}>
                      <Td>
                        <Badge tone={ok ? "live" : "down"}>
                          <Lamp state={ok ? "live" : "down"} />
                          {l.status}
                        </Badge>
                      </Td>
                      <Td muted title={fmt.time(l.ts)}>
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

function Td({
  children,
  muted,
  right,
  title,
  className,
}: {
  children: React.ReactNode;
  muted?: boolean;
  right?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <td
      title={title}
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
