"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { adminApi } from "@/lib/client";
import { Icon } from "@/components/Icon";
import { Badge } from "@/components/Badge";
import { Empty, LoadingDots } from "@/components/ui";
import type { PricingPayload, PricingModel } from "@/lib/gateway";

type GlobalPrice = { input?: number; output?: number; cached?: number; cache_creation?: number; reasoning?: number };
type GlobalField = "input" | "output" | "cached" | "cache_creation" | "reasoning";
const GLOBAL_FIELDS: { key: GlobalField; label: string }[] = [
  { key: "input", label: "in" },
  { key: "output", label: "out" },
  { key: "cached", label: "cached" },
  { key: "cache_creation", label: "cache write" },
  { key: "reasoning", label: "reasoning" },
];

/**
 * Dedicated Pricing page (promoted from the Settings-embedded PricingEditor).
 * Two independent backend stores, shown as two sections:
 *  - per-provider-model overrides (config.yaml, highest precedence)
 *  - global per-model overrides (SQLite `pricing_overrides`, applies unless a
 *    per-provider override exists for that model — see the "shadowed by" badge)
 */
export function PricingView() {
  const router = useRouter();
  const [data, setData] = useState<PricingPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [query, setQuery] = useState("");
  const [onlyOverridden, setOnlyOverridden] = useState(false);
  const [edits, setEdits] = useState<Record<string, { in: string; out: string }>>({});
  const [globalEdits, setGlobalEdits] = useState<Record<string, Partial<Record<GlobalField, string>>>>({});

  const load = useCallback(async () => {
    const r = await adminApi.pricing();
    if (r.ok && r.data) {
      setData(r.data);
      setError("");
    } else setError(r.error ?? "could not load pricing");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function keyOf(pid: string, mid: string) {
    return `${pid}/${mid}`;
  }
  function field(pid: string, m: PricingModel, side: "in" | "out"): string {
    const k = keyOf(pid, m.id);
    if (edits[k]?.[side] !== undefined) return edits[k]![side];
    const v = side === "in" ? m.price_in : m.price_out;
    return v == null ? "" : String(v);
  }
  function setField(pid: string, mid: string, side: "in" | "out", val: string) {
    const k = keyOf(pid, mid);
    setEdits((e) => ({ ...e, [k]: { in: e[k]?.in ?? "", out: e[k]?.out ?? "", [side]: val } }));
  }

  async function save(pid: string, m: PricingModel) {
    const k = keyOf(pid, m.id);
    setBusy(k);
    const rawIn = field(pid, m, "in").trim();
    const rawOut = field(pid, m, "out").trim();
    const price_in = rawIn === "" ? null : Number(rawIn);
    const price_out = rawOut === "" ? null : Number(rawOut);
    const r = await adminApi.setModelPrice(pid, m.id, { price_in, price_out });
    setBusy("");
    if (!r.ok) {
      setError(r.error ?? "save failed");
      return;
    }
    setEdits((e) => {
      const n = { ...e };
      delete n[k];
      return n;
    });
    await load();
  }

  async function reset(pid: string, m: PricingModel) {
    setBusy(keyOf(pid, m.id));
    await adminApi.setModelPrice(pid, m.id, { price_in: null, price_out: null });
    setBusy("");
    setEdits((e) => {
      const n = { ...e };
      delete n[keyOf(pid, m.id)];
      return n;
    });
    await load();
  }

  function globalField(modelId: string, key: GlobalField, current: GlobalPrice | undefined): string {
    const edited = globalEdits[modelId]?.[key];
    if (edited !== undefined) return edited;
    const v = current?.[key];
    return v == null ? "" : String(v);
  }
  function setGlobalField(modelId: string, key: GlobalField, val: string) {
    setGlobalEdits((e) => ({ ...e, [modelId]: { ...e[modelId], [key]: val } }));
  }

  async function saveGlobal(modelId: string, current: GlobalPrice | undefined) {
    setBusy(`global/${modelId}`);
    const payload: GlobalPrice = {};
    for (const { key } of GLOBAL_FIELDS) {
      const raw = globalField(modelId, key, current).trim();
      if (raw !== "") payload[key] = Number(raw);
    }
    const r = await adminApi.setRuntimePrice(modelId, payload);
    setBusy("");
    if (!r.ok) {
      setError(r.error ?? "save failed");
      return;
    }
    setGlobalEdits((e) => {
      const n = { ...e };
      delete n[modelId];
      return n;
    });
    await load();
  }

  async function clearGlobal(modelId: string) {
    setBusy(`global/${modelId}`);
    await adminApi.deleteRuntimePrice(modelId);
    setBusy("");
    setGlobalEdits((e) => {
      const n = { ...e };
      delete n[modelId];
      return n;
    });
    await load();
  }

  if (!data && !error) return <LoadingDots />;

  const q = query.trim().toLowerCase();
  const matches = (pid: string, mid: string) => !q || pid.toLowerCase().includes(q) || mid.toLowerCase().includes(q);
  const isOverridden = (m: PricingModel) => m.price_in != null || m.price_out != null;

  const providers = (data?.providers ?? [])
    .map((p) => ({
      ...p,
      models: p.models.filter((m) => matches(p.id, m.id) && (!onlyOverridden || isOverridden(m))),
    }))
    .filter((p) => p.models.length > 0);

  // Deduped flat model list for the global-overrides section, plus which
  // provider (if any) currently shadows it with a per-provider override.
  const globalModels = new Map<string, { shadowedBy?: string }>();
  for (const p of data?.providers ?? []) {
    for (const m of p.models) {
      if (!matches(p.id, m.id)) continue;
      const existing = globalModels.get(m.id);
      if (isOverridden(m)) globalModels.set(m.id, { shadowedBy: p.id });
      else if (!existing) globalModels.set(m.id, {});
    }
  }
  const overridesMap = data?.overrides ?? {};
  const globalRows = [...globalModels.entries()].filter(
    ([id]) => !onlyOverridden || overridesMap[id] != null,
  );

  return (
    <div>
      <button
        onClick={() => router.push("/config")}
        className="mb-4 inline-flex items-center gap-1 rounded-brand border border-border bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-muted transition-colors hover:border-text-subtle hover:bg-surface-3 hover:text-text"
      >
        <Icon name="arrow_back" size={14} /> Settings
      </button>

      <div className="mb-5">
        <h1 className="text-[30px] font-bold tracking-tight heading-gradient heading-accent">Pricing</h1>
        <p className="mt-1 text-[13px] text-text-muted">$/1M tokens — override the auto rate per model.</p>
      </div>

      {error && <p className="mb-3 text-[12px] text-danger">{error}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search provider or model…"
          className="w-64 rounded-brand border border-border bg-bg px-3 py-1.5 text-[13px] text-text placeholder:text-text-subtle focus:border-accent focus:outline-none"
        />
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text-muted">
          <input type="checkbox" checked={onlyOverridden} onChange={(e) => setOnlyOverridden(e.target.checked)} />
          show only overridden
        </label>
      </div>

      {/* Section A — per-provider-model overrides (config.yaml, highest precedence) */}
      {providers.length === 0 ? (
        <Empty>No models match.</Empty>
      ) : (
        <div className="space-y-4">
          {providers.map((p) => (
            <div key={p.id} className="overflow-hidden rounded-brand-lg card">
              <div className="border-b border-border-subtle bg-bg-alt px-4 py-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">{p.id}</span>
                <span className="ml-2 text-[11px] text-text-subtle">
                  {p.models.length} model{p.models.length > 1 ? "s" : ""}
                </span>
              </div>
              <table className="w-full text-[13px]">
                <tbody>
                  {p.models.map((m) => {
                    const k = keyOf(p.id, m.id);
                    const overridden = isOverridden(m);
                    return (
                      <tr key={m.id} className="border-b border-border-subtle last:border-b-0">
                        <td className="w-full truncate px-4 py-2 tnum text-text">{m.id}</td>
                        <td className="whitespace-nowrap px-2 py-2">
                          <label className="flex items-center gap-1 text-[11px] text-text-subtle">
                            in
                            <input
                              value={field(p.id, m, "in")}
                              onChange={(e) => setField(p.id, m.id, "in", e.target.value)}
                              placeholder={m.default_in == null ? "—" : String(m.default_in)}
                              inputMode="decimal"
                              className="w-16 rounded border border-border bg-bg px-1.5 py-1 text-right tnum text-[12px] text-text placeholder:text-text-subtle focus:border-accent focus:outline-none"
                            />
                          </label>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2">
                          <label className="flex items-center gap-1 text-[11px] text-text-subtle">
                            out
                            <input
                              value={field(p.id, m, "out")}
                              onChange={(e) => setField(p.id, m.id, "out", e.target.value)}
                              placeholder={m.default_out == null ? "—" : String(m.default_out)}
                              inputMode="decimal"
                              className="w-16 rounded border border-border bg-bg px-1.5 py-1 text-right tnum text-[12px] text-text placeholder:text-text-subtle focus:border-accent focus:outline-none"
                            />
                          </label>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-right">
                          <button
                            onClick={() => save(p.id, m)}
                            disabled={busy === k}
                            className="rounded p-1 text-text-subtle hover:text-accent disabled:opacity-50"
                            title="Save override"
                            aria-label="Save price"
                          >
                            <Icon name="save" size={16} />
                          </button>
                          {overridden && (
                            <button
                              onClick={() => reset(p.id, m)}
                              disabled={busy === k}
                              className="ml-1 rounded p-1 text-[11px] text-text-subtle hover:text-text disabled:opacity-50"
                              title="Clear override (use the auto rate)"
                            >
                              default
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Section B — global per-model overrides (SQLite, applies unless a per-provider override exists) */}
      <details className="group mt-4 overflow-hidden rounded-brand-lg card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
          <div>
            <h2 className="text-[14px] font-semibold text-text">Global overrides</h2>
            <p className="text-[12px] text-text-muted">
              Applies to every provider unless a per-provider override (above) is set for that specific model.
            </p>
          </div>
          <Icon name="expand_more" size={18} className="text-text-subtle transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-border-subtle p-4">
          {globalRows.length === 0 ? (
            <Empty>No models match.</Empty>
          ) : (
            <div className="space-y-2">
              {globalRows.map(([modelId, { shadowedBy }]) => {
                const current = overridesMap[modelId];
                const k = `global/${modelId}`;
                return (
                  <div key={modelId} className="flex flex-wrap items-center gap-2 border-b border-border-subtle pb-2 last:border-b-0">
                    <span className="min-w-0 flex-1 truncate tnum text-[13px] text-text">{modelId}</span>
                    {shadowedBy && (
                      <Badge tone="warn">shadowed by per-provider override on {shadowedBy}</Badge>
                    )}
                    {GLOBAL_FIELDS.map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-1 text-[11px] text-text-subtle">
                        {label}
                        <input
                          value={globalField(modelId, key, current)}
                          onChange={(e) => setGlobalField(modelId, key, e.target.value)}
                          inputMode="decimal"
                          className="w-14 rounded border border-border bg-bg px-1.5 py-1 text-right tnum text-[12px] text-text placeholder:text-text-subtle focus:border-accent focus:outline-none"
                        />
                      </label>
                    ))}
                    <button
                      onClick={() => saveGlobal(modelId, current)}
                      disabled={busy === k}
                      className="rounded p-1 text-text-subtle hover:text-accent disabled:opacity-50"
                      title="Save global override"
                      aria-label="Save global price"
                    >
                      <Icon name="save" size={16} />
                    </button>
                    {current && (
                      <button
                        onClick={() => clearGlobal(modelId)}
                        disabled={busy === k}
                        className="rounded p-1 text-[11px] text-text-subtle hover:text-text disabled:opacity-50"
                        title="Clear global override"
                      >
                        clear
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
