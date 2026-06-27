"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/client";
import { Badge } from "@/components/Badge";
import { RichCard, CardTitle } from "@/components/RichCard";
import { CooldownTimer } from "@/components/CooldownTimer";
import { fmt, Empty } from "@/components/ui";
import { BudgetForm } from "@/components/BudgetForm";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import type { BudgetStatus, KeyUsageRow } from "@/lib/gateway";

const WINDOW_LABELS: Record<string, string> = {
  "5h": "5H", "24h": "24H", "7day": "7D", "30day": "30D",
};

function windowLabel(w: string): string {
  return WINDOW_LABELS[w] ?? w.replace("day", "D").replace("h", "H");
}

/**
 * Budget Tracker — scoped spend budgets (global / per-provider / per-model /
 * per-key) with an Add / Edit / Remove flow: consumption vs limit, a fill bar,
 * and a live reset countdown.
 */
export function BudgetTracker() {
  const [budgets, setBudgets] = useState<BudgetStatus[]>([]);
  const [keys, setKeys] = useState<KeyUsageRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<{ open: boolean; initial: BudgetStatus | null }>({ open: false, initial: null });
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = () => {
    void adminApi.budgets().then((r) => {
      if (!r.ok) setError(r.error ?? "could not reach the gateway");
      else { setBudgets(r.data?.budgets ?? []); }
      setLoaded(true);
    });
    void adminApi.keysUsage().then((r) => { if (r.ok) setKeys(r.data?.keys ?? []); });
  };

  useEffect(() => { refresh(); }, []);

  if (error) return <Empty>{error}</Empty>;
  if (!loaded) return <Empty>Loading...</Empty>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-text">Budgets</h1>
        <p className="mt-1 text-[13px] text-text-muted">
          Spend caps (USD or tokens) with live reset countdowns.
        </p>
      </div>

      {/* -- Budgets -- */}
      <div className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-text">Overall</h2>
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

        {budgets.filter((b) => b.scope.type !== "key").length === 0 ? (
          !form.open && <Empty>No budgets yet. Add one to cap spend globally, per provider, or per model.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {budgets.filter((b) => b.scope.type !== "key").map((b) => (
              <RichCard
                key={b.key}
                header={
                  <>
                    <CardTitle title={b.label} sub={`${b.scope.type} · ${windowLabel(b.window)}`} />
                    <Badge tone={b.exhausted ? "down" : b.alert ? "warn" : "live"}>
                      {b.exhausted ? "exhausted" : b.alert ? "alert" : "active"}
                    </Badge>
                  </>
                }
              >
                <div className="flex h-full flex-col gap-2.5">
                  <p className="min-h-[18px] text-[12px] text-text-muted">
                    {b.note ?? "\u00A0"}
                  </p>
                  <div className="mt-auto flex flex-col gap-2.5">
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
                      </span>
                      <CooldownTimer ms={b.reset_in_ms} tone="muted" icon="restart_alt" keepZero />
                    </div>
                    <div className="min-h-[16px] text-[11px] text-text-subtle">
                      {b.est_converse != null
                        ? (b.unit === "usd" ? `est. ${fmt.compact(b.est_converse)} tok left` : `est. $${b.est_converse.toFixed(2)} left`)
                        : "\u00A0"}
                    </div>
                    <div className="flex items-center gap-2 border-t border-border-subtle pt-2.5">
                      <Button variant="ghost" className="px-2.5 py-1 text-[12px]" onClick={() => setForm({ open: true, initial: b })}>
                        <Icon name="edit" size={14} /> Edit
                      </Button>
                      <Button
                        variant="danger"
                        className="px-2.5 py-1 text-[12px]"
                        onClick={() => setConfirmRemove(b.key)}
                      >
                        <Icon name="delete" size={14} /> Remove
                      </Button>
                    </div>
                  </div>
                </div>
              </RichCard>
            ))}
          </div>
        )}
      </div>

      {/* -- Keys -- */}
      <div>
        <h2 className="mb-3 text-[15px] font-semibold text-text">Keys</h2>
        {keys.length === 0 ? (
          <Empty>No gateway keys yet. Add one on the Endpoint page.</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {keys.map((k) => (
              <RichCard
                key={k.fingerprint}
                header={
                  <>
                    <CardTitle title={k.name} sub={k.budget ? `key · ${windowLabel(k.budget.window)}` : "key · no limit"} />
                    {k.expires && Date.now() > k.expires ? (
                      <Badge tone="down">expired</Badge>
                    ) : k.budget?.exhausted ? (
                      <Badge tone="down">exhausted</Badge>
                    ) : (
                      <Badge tone="live">active</Badge>
                    )}
                  </>
                }
              >
                <div className="flex h-full flex-col gap-2.5">
                  {k.budget ? (
                    <>
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className={`h-full rounded-full transition-all ${k.budget.exhausted ? "bg-danger" : k.budget.alert ? "bg-warning" : "bg-accent"}`}
                          style={{ width: `${Math.min(100, Math.round(k.budget.pct * 100))}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="tnum text-text-muted">
                          {k.budget.unit === "usd"
                            ? `$${k.budget.spent.toFixed(2)} / $${k.budget.limit.toFixed(2)}`
                            : `${fmt.compact(k.budget.spent)} / ${fmt.compact(k.budget.limit)} tokens`}
                        </span>
                        <CooldownTimer ms={k.budget.reset_in_ms} tone="muted" icon="restart_alt" keepZero />
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="tnum text-text-muted">${k.spent.toFixed(2)} spent</span>
                      <span className="text-text-subtle">no limit</span>
                    </div>
                  )}
                  <div className="mt-auto text-[11px] text-text-subtle">
                    {k.expires ? `expires ${fmt.date(k.expires)}` : "no expiry"}
                  </div>
                </div>
              </RichCard>
            ))}
          </div>
        )}
      </div>

      {confirmRemove && (
        <ConfirmModal
          title="Remove budget"
          message="This will stop tracking spend for this scope. Continue?"
          confirmLabel="Remove"
          onConfirm={async () => {
            const r = await adminApi.clearBudget(confirmRemove);
            if (!r.ok) setError(r.error ?? "could not remove budget");
            setConfirmRemove(null);
            refresh();
          }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}
