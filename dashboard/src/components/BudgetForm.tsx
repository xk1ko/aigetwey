"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/client";
import { Button, Input, Select, Field } from "@/components/Button";
import { Icon } from "@/components/Icon";
import type { BudgetStatus, ProviderSnapshot } from "@/lib/gateway";

const WINDOWS = ["5h", "daily", "weekly", "monthly"] as const;
type ScopeType = "global" | "provider" | "model";

const SCOPES: { id: ScopeType; icon: string; label: string; hint: string }[] = [
  { id: "global", icon: "public", label: "Global", hint: "Cap total spend across the whole gateway." },
  { id: "provider", icon: "dns", label: "Per provider", hint: "Cap one provider's spend." },
  { id: "model", icon: "neurology", label: "Per model", hint: "Cap one upstream model's spend." },
];

/**
 * Inline Add / Edit panel for a scoped budget — same shape as the "Add a
 * provider" flow: step 1 picks the scope (card grid, add only), step 2 is the
 * field set. Editing jumps straight to step 2 with the scope locked (the scope
 * is the budget's identity); every other field stays editable.
 */
export function BudgetForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: BudgetStatus | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const editing = initial !== null;
  const [scopeType, setScopeType] = useState<ScopeType | null>(initial ? initial.scope.type : null);
  const [scopeId, setScopeId] = useState(initial && initial.scope.type !== "global" ? initial.scope.id : "");
  const [providers, setProviders] = useState<string[]>([]);
  const [unit, setUnit] = useState<"usd" | "tokens">(initial?.unit ?? "usd");
  const [limit, setLimit] = useState(String(initial?.limit ?? ""));
  const [window, setWindow] = useState<(typeof WINDOWS)[number]>(initial?.window ?? "monthly");
  const [alertAt, setAlertAt] = useState(initial ? String(Math.round(initial.alert_at * 100)) : "80");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void adminApi.providers().then((r) => {
      if (r.ok && r.data) setProviders(r.data.providers.map((p: ProviderSnapshot) => p.id));
    });
  }, []);

  async function save() {
    const limitNum = Number(limit);
    if (!Number.isFinite(limitNum) || limitNum <= 0) return setError("limit must be a positive number");
    const alertPct = Number(alertAt);
    if (!Number.isFinite(alertPct) || alertPct <= 0 || alertPct > 100) return setError("alert % must be 1–100");
    if (scopeType !== "global" && !scopeId.trim()) return setError(`pick a ${scopeType}`);
    const scope =
      scopeType === "global" ? { type: "global" as const } : { type: scopeType!, id: scopeId.trim() };
    setSaving(true);
    setError("");
    try {
      const r = await adminApi.setBudget({ scope, unit, limit: limitNum, window, alert_at: alertPct / 100 });
      if (!r.ok) return setError(r.error ?? "could not save budget");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const panel = "mb-5 rounded-brand-lg border border-border bg-surface p-5 shadow-soft";

  // step 1 (add only): pick the scope.
  if (scopeType === null) {
    return (
      <div className={panel}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-text">Add a budget</h2>
            <p className="mt-0.5 text-[12.5px] text-text-muted">Pick what this budget caps — the rest is one short form.</p>
          </div>
          <button type="button" onClick={onCancel} className="flex-none text-text-subtle hover:text-text" aria-label="Cancel">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { setScopeType(s.id); setScopeId(""); }}
              className="group flex items-start gap-3 rounded-brand-lg border border-border bg-bg p-4 text-left transition-colors hover:border-accent hover:bg-accent-soft"
            >
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-brand bg-surface-2 text-text-muted group-hover:text-accent">
                <Icon name={s.icon} size={20} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-text">{s.label}</span>
                <span className="mt-1 block text-[11.5px] text-text-muted">{s.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const scopeMeta = SCOPES.find((s) => s.id === scopeType)!;

  // step 2: the field set.
  return (
    <div className={panel}>
      <div className="mb-4 flex items-center gap-2.5 border-b border-border-subtle pb-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-brand bg-surface-2 text-text-muted">
          <Icon name={scopeMeta.icon} size={17} />
        </span>
        <div>
          <div className="text-[13.5px] font-semibold text-text">{editing ? "Edit budget" : scopeMeta.label}</div>
          <div className="tnum text-[11px] text-text-subtle">
            {scopeType === "global" ? "whole gateway" : `${scopeType} · ${editing ? initial!.label : scopeId || "—"}`}
          </div>
        </div>
        {editing ? null : (
          <button
            type="button"
            onClick={() => { setScopeType(null); setError(""); }}
            className="ml-auto inline-flex items-center gap-1 text-[12px] text-text-subtle hover:text-text"
          >
            <Icon name="arrow_back" size={14} /> change scope
          </button>
        )}
      </div>

      <div className="space-y-3">
        {scopeType === "provider" && (
          <Field label="Provider">
            <Select value={scopeId} onChange={(e) => setScopeId(e.target.value)} disabled={editing}>
              <option value="">Select a provider…</option>
              {providers.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
        )}
        {scopeType === "model" && (
          <Field label="Model" hint="upstream model id">
            <Input value={scopeId} onChange={(e) => setScopeId(e.target.value)} placeholder="claude-opus-4-6" disabled={editing} />
          </Field>
        )}

        <Field label="Unit">
          <div className="flex gap-2">
            <button type="button" onClick={() => setUnit("usd")} className={`rounded-brand px-3 py-1.5 text-[13px] font-medium transition-colors ${unit === "usd" ? "bg-accent/12 text-accent" : "bg-surface-2 text-text-muted hover:text-text"}`}>USD</button>
            <button type="button" onClick={() => setUnit("tokens")} className={`rounded-brand px-3 py-1.5 text-[13px] font-medium transition-colors ${unit === "tokens" ? "bg-accent/12 text-accent" : "bg-surface-2 text-text-muted hover:text-text"}`}>Tokens</button>
          </div>
        </Field>
        <Field label="Limit" hint={unit === "usd" ? "$" : "tokens"}>
          <Input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" placeholder={unit === "usd" ? "50.00" : "1000000"} />
        </Field>
        <Field label="Window">
          <Select value={window} onChange={(e) => setWindow(e.target.value as (typeof WINDOWS)[number])}>
            {WINDOWS.map((w) => <option key={w} value={w}>{w}</option>)}
          </Select>
        </Field>
        <Field label="Alert at" hint="%">
          <Input value={alertAt} onChange={(e) => setAlertAt(e.target.value)} inputMode="numeric" placeholder="80" />
        </Field>
      </div>

      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="button" disabled={saving} onClick={save}>{saving ? "Saving…" : editing ? "Save changes" : "Add budget"}</Button>
      </div>
    </div>
  );
}
