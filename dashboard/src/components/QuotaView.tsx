"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/client";
import { Badge } from "@/components/Badge";
import { RichCard, CardTitle } from "@/components/RichCard";
import { CooldownTimer } from "@/components/CooldownTimer";
import { fmt, Empty } from "@/components/ui";
import { BudgetForm } from "@/components/BudgetForm";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import type { QuotaSnapshot, BudgetStatus } from "@/lib/gateway";

/**
 * Budget Tracker — scoped spend budgets (global / per-provider / per-model /
 * per-key) with an Add / Edit / Remove flow, shown above the per-provider token
 * quota grid (the older hard token cap that drives each provider card's reset
 * countdown): consumption vs limit, a fill bar, and a live reset countdown.
 */
export function QuotaView() {
  const [quota, setQuota] = useState<QuotaSnapshot[] | null>(null);
  const [budgets, setBudgets] = useState<BudgetStatus[]>([]);
  const [form, setForm] = useState<{ open: boolean; initial: BudgetStatus | null }>({ open: false, initial: null });
  const [error, setError] = useState("");

  const refresh = () =>
    void adminApi.quota().then((r) => {
      if (!r.ok) setError(r.error ?? "could not reach the gateway");
      else { setQuota(r.data?.quota ?? []); setBudgets(r.data?.budgets ?? []); }
    });

  useEffect(() => { refresh(); }, []);

  if (error) return <Empty>{error}</Empty>;
  if (!quota) return <Empty>Loading…</Empty>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-text">Budget Tracker</h1>
        <p className="mt-1 text-[13px] text-text-muted">
          Spend caps (USD or tokens) and per-provider token quotas, with live reset countdowns.
        </p>
      </div>

      {/* ── Budgets ── */}
      <div className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-text">Budgets</h2>
          {!form.open && (
            <Button onClick={() => setForm({ open: true, initial: null })}>
              <Icon name="add" size={16} /> Add budget
            </Button>
          )}
        </div>

        {form.open && (
          <BudgetForm
            key={form.initial?.key ?? "new"}
            initial={form.initial}
            onSaved={() => { setForm({ open: false, initial: null }); refresh(); }}
            onCancel={() => setForm({ open: false, initial: null })}
          />
        )}

        {budgets.length === 0 ? (
          !form.open && <Empty>No budgets yet. Add one to cap spend globally, per provider, or per model.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {budgets.map((b) => (
              <RichCard
                key={b.key}
                header={
                  <>
                    <CardTitle title={b.label} sub={`${b.scope.type} · ${b.window}`} />
                    <Badge tone={b.exhausted ? "down" : b.alert ? "warn" : "live"}>
                      {b.exhausted ? "exhausted" : b.alert ? "alert" : "active"}
                    </Badge>
                  </>
                }
              >
                <div className="space-y-2.5">
                  {b.note && <p className="text-[12px] text-text-muted">{b.note}</p>}
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full transition-all ${b.exhausted ? "bg-danger" : b.alert ? "bg-warning" : "bg-accent"}`}
                      style={{ width: `${Math.min(100, Math.round(b.pct * 100))}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="tnum text-text-muted">
                      {b.unit === "usd"
                        ? `$${b.spent.toFixed(2)} / $${b.limit.toFixed(2)}`
                        : `${fmt.compact(b.spent)} / ${fmt.compact(b.limit)} tokens`}
                      {b.est_converse != null
                        ? b.unit === "usd" ? ` · ~${fmt.compact(b.est_converse)} tok` : ` · ~$${b.est_converse.toFixed(2)}`
                        : " · —"}
                    </span>
                    <CooldownTimer ms={b.reset_in_ms} tone="muted" icon="restart_alt" keepZero />
                  </div>
                  <div className="flex items-center gap-2 border-t border-border-subtle pt-2.5">
                    <Button variant="ghost" className="px-2.5 py-1 text-[12px]" onClick={() => setForm({ open: true, initial: b })}>
                      <Icon name="edit" size={14} /> Edit
                    </Button>
                    <Button
                      variant="danger"
                      className="px-2.5 py-1 text-[12px]"
                      onClick={async () => { const r = await adminApi.clearBudget(b.key); if (!r.ok) setError(r.error ?? "could not remove budget"); refresh(); }}
                    >
                      <Icon name="delete" size={14} /> Remove
                    </Button>
                  </div>
                </div>
              </RichCard>
            ))}
          </div>
        )}
      </div>

      {/* ── Per-provider quota grid — only shown once a provider actually has a
          `quota:` cap configured; superseded by per-provider token budgets, so we
          don't advertise it with an empty state. ── */}
      {quota.length > 0 && (
        <>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-semibold text-text">Provider quotas</h2>
            <span className="text-[12px] text-text-subtle">hard token cap per provider, per window</span>
          </div>
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
        </>
      )}
    </div>
  );
}
