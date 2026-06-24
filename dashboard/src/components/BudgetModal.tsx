"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/client";
import { Button, Input, Select, Field } from "@/components/Button";
import type { BudgetStatus, ProviderSnapshot } from "@/lib/gateway";

const WINDOWS = ["5h", "daily", "weekly", "monthly"] as const;
type ScopeType = "global" | "provider" | "model";

export function BudgetModal({
  initial,
  onSaved,
  onCancel,
}: {
  initial: BudgetStatus | null; // null = add; set = edit (scope locked)
  onSaved: () => void;
  onCancel: () => void;
}) {
  const editing = initial !== null;
  const [scopeType, setScopeType] = useState<ScopeType>(initial?.scope.type ?? "global");
  const [scopeId, setScopeId] = useState(initial && initial.scope.type !== "global" ? initial.scope.id : "");
  const [providers, setProviders] = useState<string[]>([]);
  const [unit, setUnit] = useState<"usd" | "tokens">(initial?.unit ?? "usd");
  const [limit, setLimit] = useState(String(initial?.limit ?? ""));
  const [window, setWindow] = useState<(typeof WINDOWS)[number]>(initial?.window ?? "monthly");
  const [alertAt, setAlertAt] = useState("80");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void adminApi.providers().then((r) => {
      // ProviderSnapshot.id — verified in lib/gateway.ts (field is `id`).
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
      scopeType === "global" ? { type: "global" as const } : { type: scopeType, id: scopeId.trim() };
    setSaving(true);
    try {
      const r = await adminApi.setBudget({ scope, unit, limit: limitNum, window, alert_at: alertPct / 100 });
      if (!r.ok) return setError(r.error ?? "could not save budget");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-brand-lg border border-border bg-surface p-5 shadow-elevated" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-[15px] font-semibold text-text">{editing ? "Edit budget" : "Add budget"}</h2>
        <div className="space-y-3">
          <Field label="Scope">
            <Select value={scopeType} onChange={(e) => { setScopeType(e.target.value as ScopeType); setScopeId(""); }} disabled={editing}>
              <option value="global">Global</option>
              <option value="provider">Provider</option>
              <option value="model">Model</option>
            </Select>
          </Field>

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

          <div className="flex gap-2">
            <button type="button" onClick={() => setUnit("usd")} className={`rounded-brand px-2.5 py-1 text-[13px] font-medium transition-colors ${unit === "usd" ? "bg-accent/12 text-accent" : "text-text-muted hover:text-text"}`}>USD</button>
            <button type="button" onClick={() => setUnit("tokens")} className={`rounded-brand px-2.5 py-1 text-[13px] font-medium transition-colors ${unit === "tokens" ? "bg-accent/12 text-accent" : "text-text-muted hover:text-text"}`}>Tokens</button>
          </div>

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

          {error ? <p className="text-[12px] text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
