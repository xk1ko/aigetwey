"use client";

import { useEffect, useState } from "react";
import { RichCard } from "@/components/RichCard";
import { fmt, Empty } from "@/components/ui";
import type { UsageLog } from "@/lib/gateway";

/**
 * Compact live feed of the latest requests, modeled on 9router's RecentRequests
 * card (status dot · model · in/out · when). aigetwey has no usage SSE, so this
 * polls /admin/logs on an interval instead of subscribing to a stream.
 */
export function RecentRequests({ limit = 8, pollMs = 4000 }: { limit?: number; pollMs?: number }) {
  const [logs, setLogs] = useState<UsageLog[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/gw/admin/logs?limit=${limit}`);
        if (!res.ok) return;
        const d = (await res.json()) as { logs: UsageLog[] };
        if (alive) setLogs(d.logs ?? []);
      } catch {
        /* transient — keep the last good list */
      }
    };
    void load();
    const t = setInterval(load, pollMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [limit, pollMs]);

  return (
    <RichCard header={<span className="text-[13px] font-semibold text-text">Recent requests</span>}>
      {logs.length === 0 ? (
        <Empty>No requests yet.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-text-subtle">
                <th className="w-2 pb-2" />
                <th className="pb-2 text-left text-[10px] font-medium uppercase tracking-wider">Model</th>
                <th className="pb-2 text-right text-[10px] font-medium uppercase tracking-wider">In / Out</th>
                <th className="pb-2 text-right text-[10px] font-medium uppercase tracking-wider">When</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((r, i) => {
                const ok = r.status >= 200 && r.status < 300;
                return (
                  <tr key={`${r.ts}-${i}`} className="border-t border-border-subtle">
                    <td className="py-2">
                      <span className={`block h-1.5 w-1.5 rounded-full ${ok ? "bg-success" : "bg-danger"}`} />
                    </td>
                    <td className="py-2 text-[12.5px] text-text" title={`${r.alias} → ${r.provider}/${r.model}`}>
                      <span className="tnum truncate">{r.model}</span>
                    </td>
                    <td className="py-2 text-right tnum text-[12.5px] whitespace-nowrap">
                      <span className="text-info">{fmt.compact(r.tokens_in)}↑</span>{" "}
                      <span className="text-success">{fmt.compact(r.tokens_out)}↓</span>
                    </td>
                    <td className="py-2 text-right text-[12.5px] text-text-muted whitespace-nowrap">{fmt.ago(r.ts)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </RichCard>
  );
}
