"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/client";
import { Badge } from "@/components/Badge";
import { RichCard, CardTitle } from "@/components/RichCard";
import { CooldownTimer } from "@/components/CooldownTimer";
import { fmt, Empty } from "@/components/ui";
import type { QuotaSnapshot } from "@/lib/gateway";

/**
 * Quota Tracker (9router parity) — the per-provider token budgets that were only
 * visible as a strip on each provider card, now their own page: consumption vs
 * limit, a fill bar, and a live countdown to the next scheduled window reset.
 */
export function QuotaView() {
  const [quota, setQuota] = useState<QuotaSnapshot[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void adminApi.quota().then((r) => {
      if (!r.ok) setError(r.error ?? "could not reach the gateway");
      else setQuota(r.data?.quota ?? []);
    });
  }, []);

  if (error) return <Empty>{error}</Empty>;
  if (!quota) return <Empty>Loading…</Empty>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-text">Quota Tracker</h1>
        <p className="mt-1 text-[13px] text-text-muted">
          Per-provider token budgets and when each window resets.
        </p>
      </div>

      {quota.length === 0 ? (
        <Empty>
          No quotas configured. Add a <span className="tnum">quota</span> block to a provider in Settings.
        </Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {quota.map((q) => (
            <RichCard
              key={q.provider}
              header={
                <>
                  <CardTitle title={q.provider} sub={`window · ${q.window}`} />
                  <Badge tone={q.exhausted ? "down" : "live"}>{q.exhausted ? "exhausted" : "active"}</Badge>
                </>
              }
            >
              <div className="space-y-2.5">
                {q.limit_tokens ? (
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full ${q.exhausted ? "bg-danger" : "bg-accent"}`}
                      style={{ width: `${Math.round((q.pct ?? 0) * 100)}%` }}
                    />
                  </div>
                ) : null}
                <div className="flex items-center justify-between text-[12px]">
                  <span className="tnum text-text-muted">
                    {fmt.compact(q.consumed)}
                    {q.limit_tokens ? ` / ${fmt.compact(q.limit_tokens)}` : ""} tokens
                  </span>
                  <CooldownTimer ms={q.reset_in_ms} tone="muted" icon="restart_alt" keepZero />
                </div>
              </div>
            </RichCard>
          ))}
        </div>
      )}
    </div>
  );
}
