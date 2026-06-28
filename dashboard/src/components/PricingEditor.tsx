"use client";

import { useEffect, useState, useCallback } from "react";
import { adminApi } from "@/lib/client";
import { CardTitle } from "@/components/RichCard";
import { Icon } from "@/components/Icon";
import { Empty } from "@/components/ui";
import type { PricingPayload, PricingModel } from "@/lib/gateway";

/**
 * Per-model price override editor (aigloo's Pricing settings, adapted). Each model
 * shows the auto-resolved default from the pricing table; typing an override stores
 * it in config, and "use default" clears it. All rates are $/1M tokens.
 */
export function PricingEditor() {
  const [data, setData] = useState<PricingPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [edits, setEdits] = useState<Record<string, { in: string; out: string }>>({});

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

  const providers = data?.providers.filter((p) => p.models.length > 0) ?? [];

  const overrideCount = providers.reduce(
    (n, p) => n + p.models.filter((m) => m.price_in != null || m.price_out != null).length,
    0,
  );

  return (
    <details className="group overflow-hidden rounded-brand-lg card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <CardTitle title="Pricing" sub="$/1M tokens — override the auto rate per model" />
        <span className="flex items-center gap-2">
          {overrideCount > 0 && <span className="text-[11px] text-text-subtle">{overrideCount} override{overrideCount > 1 ? "s" : ""}</span>}
          <Icon name="expand_more" size={18} className="text-text-subtle transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="border-t border-border-subtle p-4">
      {error && <p className="mb-2 text-[12px] text-danger">{error}</p>}
      {providers.length === 0 ? (
        <Empty>No models yet. Add models to a provider to price them.</Empty>
      ) : (
        <div className="space-y-2">
          {providers.map((p) => {
            const pOverrides = p.models.filter((m) => m.price_in != null || m.price_out != null).length;
            return (
            <details key={p.id} className="group/p overflow-hidden rounded-brand border border-border-subtle">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 bg-bg-alt px-3 py-2 [&::-webkit-details-marker]:hidden">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-text-subtle">{p.id}</span>
                <span className="flex items-center gap-2 text-[11px] text-text-subtle">
                  <span>{p.models.length} model{p.models.length > 1 ? "s" : ""}{pOverrides > 0 ? ` · ${pOverrides} override` : ""}</span>
                  <Icon name="expand_more" size={16} className="transition-transform group-open/p:rotate-180" />
                </span>
              </summary>
              <div className="">
                {p.models.map((m) => {
                  const k = keyOf(p.id, m.id);
                  const overridden = m.price_in != null || m.price_out != null;
                  return (
                    <div key={m.id} className="flex items-center gap-2 border-b border-border-subtle px-3 py-2 last:border-b-0">
                      <span className="tnum min-w-0 flex-1 truncate text-[13px] text-text">{m.id}</span>
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
                      <button
                        onClick={() => save(p.id, m)}
                        disabled={busy === k}
                        className="rounded p-1 text-text-subtle hover:text-accent disabled:opacity-50"
                        title="Save override"
                        aria-label="Save price"
                      >
                        save
                      </button>
                      {overridden && (
                        <button
                          onClick={() => reset(p.id, m)}
                          disabled={busy === k}
                          className="rounded p-1 text-[11px] text-text-subtle hover:text-text disabled:opacity-50"
                          title="Clear override (use the auto rate)"
                        >
                          default
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </details>
            );
          })}
        </div>
      )}
      </div>
    </details>
  );
}
