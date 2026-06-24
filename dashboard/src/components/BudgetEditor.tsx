"use client";

import { useState } from "react";
import { adminApi } from "@/lib/client";
import { Button, Input, Select, Field } from "@/components/Button";
import type { BudgetStatus } from "@/lib/gateway";

const WINDOWS = ["5h", "daily", "weekly", "monthly"] as const;

export function BudgetEditor({
  initial,
  onSaved,
  onCancel,
}: {
  initial: BudgetStatus | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [unit, setUnit] = useState<"usd" | "tokens">(initial?.unit ?? "usd");
  const [limit, setLimit] = useState(String(initial?.limit ?? ""));
  const [window, setWindow] = useState<(typeof WINDOWS)[number]>(initial?.window ?? "monthly");
  const [alertAt, setAlertAt] = useState("80");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const limitNum = Number(limit);
    if (!Number.isFinite(limitNum) || limitNum <= 0) {
      setError("limit must be a positive number");
      return;
    }
    const alertPct = Number(alertAt);
    if (!Number.isFinite(alertPct) || alertPct <= 0 || alertPct > 100) {
      setError("alert % must be 1–100");
      return;
    }
    setSaving(true);
    const r = await adminApi.setBudget({ unit, limit: limitNum, window, alert_at: alertPct / 100 });
    setSaving(false);
    if (!r.ok) {
      setError(r.error ?? "could not save budget");
      return;
    }
    onSaved();
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setUnit("usd")}
          className={`rounded-brand px-2.5 py-1 text-[13px] font-medium transition-colors ${unit === "usd" ? "bg-accent/12 text-accent" : "text-text-muted hover:text-text"}`}
        >
          USD
        </button>
        <button
          type="button"
          onClick={() => setUnit("tokens")}
          className={`rounded-brand px-2.5 py-1 text-[13px] font-medium transition-colors ${unit === "tokens" ? "bg-accent/12 text-accent" : "text-text-muted hover:text-text"}`}
        >
          Tokens
        </button>
      </div>

      <Field label="Limit" hint={unit === "usd" ? "$" : "tokens"}>
        <Input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" placeholder={unit === "usd" ? "50.00" : "1000000"} />
      </Field>

      <Field label="Window">
        <Select value={window} onChange={(e) => setWindow(e.target.value as (typeof WINDOWS)[number])}>
          {WINDOWS.map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
        </Select>
      </Field>

      <Field label="Alert at" hint="%">
        <Input value={alertAt} onChange={(e) => setAlertAt(e.target.value)} inputMode="numeric" placeholder="80" />
      </Field>

      {error ? <p className="text-[12px] text-danger">{error}</p> : null}

      <div className="flex items-center gap-2 pt-1">
        <Button disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
