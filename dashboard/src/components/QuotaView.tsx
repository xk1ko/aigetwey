"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/client";
import { Badge } from "@/components/Badge";
import { RichCard, CardTitle } from "@/components/RichCard";
import { CooldownTimer } from "@/components/CooldownTimer";
import { fmt, Empty } from "@/components/ui";
import { BudgetEditor } from "@/components/BudgetEditor";
import type { QuotaSnapshot, BudgetStatus } from "@/lib/gateway";

/**
 * Quota Tracker  — the per-provider token budgets that were only
 * visible as a strip on each provider card, now their own page: consumption vs
 * limit, a fill bar, and a live countdown to the next scheduled window reset.
 *
 * Also renders the global budget card (if configured) above the provider grid.
 */
export function QuotaView() {
  const [quota, setQuota] = useState<QuotaSnapshot[] | null>(null);
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  const refresh = () =>
    void adminApi.quota().then((r) => {
      if (!r.ok) setError(r.error ?? "could not reach the gateway");
      else {
        setQuota(r.data?.quota ?? []);
        setBudget(r.data?.budget ?? null);
      }
    });

  useEffect(() => { refresh(); }, []);

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

      {/* ── Global budget card ── */}
      <div className="mb-4">
        <RichCard
          header={
            <>
              <CardTitle title="Global budget" sub={budget ? `window · ${budget.window}` : "not set"} />
              {budget ? (
                <Badge tone={budget.exhausted ? "down" : budget.alert ? "warn" : "live"}>
                  {budget.exhausted ? "exhausted" : budget.alert ? "alert" : "active"}
                </Badge>
              ) : null}
            </>
          }
        >
          {editing ? (
            <BudgetEditor
              initial={budget}
              onSaved={() => { setEditing(false); refresh(); }}
              onCancel={() => setEditing(false)}
            />
          ) : budget ? (
            <div className="space-y-2.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`h-full rounded-full transition-all ${budget.exhausted ? "bg-danger" : budget.alert ? "bg-warning" : "bg-accent"}`}
                  style={{ width: `${Math.min(100, Math.round(budget.pct * 100))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[12px]">
                <span className="tnum text-text-muted">
                  {budget.unit === "usd"
                    ? `$${budget.spent.toFixed(2)} / $${budget.limit.toFixed(2)}`
                    : `${fmt.compact(budget.spent)} / ${fmt.compact(budget.limit)} tokens`}
                  {budget.est_converse != null
                    ? budget.unit === "usd"
                      ? ` · ~${fmt.compact(budget.est_converse)} tok`
                      : ` · ~$${budget.est_converse.toFixed(2)}`
                    : " · —"}
                </span>
                <CooldownTimer ms={budget.reset_in_ms} tone="muted" icon="restart_alt" keepZero />
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setEditing(true)} className="text-[12px] text-accent hover:underline">
                  Edit
                </button>
                <button
                  type="button"
                  onClick={async () => { const r = await adminApi.clearBudget(); if (!r.ok) setError(r.error ?? "could not clear budget"); refresh(); }}
                  className="text-[12px] text-text-muted hover:text-danger"
                >
                  Clear
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="text-[13px] text-accent hover:underline">
              Set a budget
            </button>
          )}
        </RichCard>
      </div>

      {/* ── Per-provider quota grid ── */}
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
                  <Badge tone={q.exhausted ? "down" : q.alert ? "warn" : "live"}>
                    {q.exhausted ? "exhausted" : q.alert ? "alert" : "active"}
                  </Badge>
                </>
              }
            >
              <div className="space-y-2.5">
                {q.limit_tokens ? (
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full transition-all ${q.exhausted ? "bg-danger" : q.alert ? "bg-warning" : "bg-accent"}`}
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
