"use client";

import { useState } from "react";
import { Lamp } from "@/components/Lamp";
import { Badge } from "@/components/Badge";
import { fmt } from "@/components/ui";
import type { UsageLog } from "@/lib/gateway";

type Filter = "all" | "ok" | "error";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ok", label: "Success" },
  { key: "error", label: "Errors" },
];

export function LogTable({ logs }: { logs: UsageLog[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  const okCount = logs.filter((l) => l.status >= 200 && l.status < 300).length;
  const errCount = logs.length - okCount;

  const shown = logs.filter((l) => {
    if (filter === "ok") return l.status >= 200 && l.status < 300;
    if (filter === "error") return l.status < 200 || l.status >= 300;
    return true;
  });

  const count = (k: Filter) => (k === "all" ? logs.length : k === "ok" ? okCount : errCount);

  return (
    <div className="overflow-hidden rounded-brand-lg border border-border bg-surface shadow-soft">
      <header className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
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
      </header>

      {shown.length === 0 ? (
        <div className="px-4 py-8 text-center text-[13px] text-text-muted">
          {logs.length === 0 ? "No requests recorded yet." : "No requests match this filter."}
        </div>
      ) : (
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
                return (
                  <tr key={i} className="border-t border-border-subtle hover:bg-surface-2/40">
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
