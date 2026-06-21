"use client";

import { useEffect, useState, useCallback } from "react";
import { adminApi } from "@/lib/client";
import { Lamp } from "@/components/Lamp";
import { Badge } from "@/components/Badge";
import { RichCard, CardTitle } from "@/components/RichCard";
import { Button, Input, Field } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { fmt, Empty } from "@/components/ui";
import type { MaskedConfig, MaskedRoute, ProviderSnapshot } from "@/lib/gateway";

/** Upstream model id for the i-th target of a route (mirrors GatewayConfig). */
function modelFor(route: MaskedRoute, i: number): string {
  if (Array.isArray(route.model)) return route.model[i] ?? route.model[0] ?? route.alias;
  if (typeof route.model === "string") return route.model;
  return route.alias;
}

export function RoutingView() {
  const [config, setConfig] = useState<MaskedConfig | null>(null);
  const [health, setHealth] = useState<ProviderSnapshot[]>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState("");

  const reload = useCallback(async () => {
    const [cfgRes, prov] = await Promise.all([fetch("/api/gw/admin/config"), adminApi.providers()]);
    if (!cfgRes.ok) {
      setError("could not reach the gateway");
      return;
    }
    setError("");
    setConfig((await cfgRes.json()) as MaskedConfig);
    setHealth(prov.data?.providers ?? []);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (error) return <Empty>{error}</Empty>;
  if (!config) return <Empty>Loading…</Empty>;

  const healthy = (pid: string) => {
    const h = health.find((x) => x.id === pid);
    return h ? h.keys.some((k) => k.healthy) : true;
  };

  async function del(alias: string) {
    setBusy(alias);
    const r = await adminApi.removeRoute(alias);
    setBusy("");
    if (!r.ok) setError(r.error ?? "failed");
    else await reload();
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-text">Routing</h1>
          <p className="mt-1 text-[13px] text-text-muted">Client alias → prioritized provider chain. First healthy one serves.</p>
        </div>
        <Button onClick={() => setAdding((v) => !v)}>
          <Icon name={adding ? "close" : "add"} size={17} />
          {adding ? "Cancel" : "Add alias"}
        </Button>
      </div>

      {adding && (
        <RouteForm
          providers={config.providers.map((p) => p.id)}
          onDone={() => { setAdding(false); void reload(); }}
        />
      )}

      {config.models.length === 0 ? (
        <Empty>No routing aliases. Add one to expose a model to your CLI tools.</Empty>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {config.models.map((route) => (
            <RichCard
              key={route.alias}
              header={
                <>
                  <CardTitle title={route.alias} sub={`${route.target.length} in chain`} />
                  <div className="flex items-center gap-2">
                    {(route.price_in !== undefined || route.price_out !== undefined) && (
                      <Badge tone="neutral">
                        {fmt.cost(route.price_in ?? 0)}/{fmt.cost(route.price_out ?? 0)} per 1M
                      </Badge>
                    )}
                    <button onClick={() => del(route.alias)} disabled={busy === route.alias} className="text-text-subtle hover:text-danger" aria-label="Remove alias">
                      <Icon name="delete" size={16} />
                    </button>
                  </div>
                </>
              }
            >
              <ol className="space-y-1.5">
                {route.target.map((pid, i) => (
                  <li key={pid + i} className="flex items-center gap-2.5 rounded-brand border border-border-subtle px-3 py-2">
                    <span className="tnum text-[11px] text-text-subtle">{i === 0 ? "primary" : `#${i + 1}`}</span>
                    <Lamp state={healthy(pid) ? "live" : "down"} />
                    <span className="text-[13px] text-text">{pid}</span>
                    <span className="ml-auto tnum text-[12px] text-text-muted">{modelFor(route, i)}</span>
                  </li>
                ))}
              </ol>
            </RichCard>
          ))}
        </div>
      )}
    </div>
  );
}

function RouteForm({ providers, onDone }: { providers: string[]; onDone: () => void }) {
  const [alias, setAlias] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [models, setModels] = useState("");
  const [priceIn, setPriceIn] = useState("");
  const [priceOut, setPriceOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function toggle(pid: string) {
    setTargets((t) => (t.includes(pid) ? t.filter((x) => x !== pid) : [...t, pid]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!alias || targets.length === 0) {
      setErr("alias and at least one target required");
      return;
    }
    setBusy(true);
    setErr("");
    const modelList = models.split(",").map((s) => s.trim()).filter(Boolean);
    const r = await adminApi.setRoute(alias, {
      target: targets,
      model: modelList.length === 0 ? undefined : modelList.length === 1 ? modelList[0] : modelList,
      price_in: priceIn ? Number(priceIn) : undefined,
      price_out: priceOut ? Number(priceOut) : undefined,
    });
    setBusy(false);
    if (r.ok) onDone();
    else setErr(r.error ?? "failed");
  }

  return (
    <form onSubmit={submit} className="mb-5 rounded-brand-lg border border-border bg-surface p-4 shadow-soft">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Alias" hint="what your CLI calls"><Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="claude-sonnet-4-6" /></Field>
        <Field label="Upstream models" hint="comma-sep, matches chain order">
          <Input value={models} onChange={(e) => setModels(e.target.value)} placeholder="claude-sonnet-4-6, claude-sonnet-4-5" />
        </Field>
        <Field label="Price in" hint="per 1M, optional"><Input value={priceIn} onChange={(e) => setPriceIn(e.target.value)} placeholder="3" /></Field>
        <Field label="Price out" hint="per 1M, optional"><Input value={priceOut} onChange={(e) => setPriceOut(e.target.value)} placeholder="15" /></Field>
      </div>
      <div className="mt-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">Chain (click to order)</span>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {providers.map((pid) => {
            const idx = targets.indexOf(pid);
            return (
              <button
                type="button"
                key={pid}
                onClick={() => toggle(pid)}
                className={`rounded-brand border px-3 py-1.5 text-[12.5px] transition-colors ${
                  idx === -1 ? "border-border text-text-muted hover:text-text" : "border-accent bg-accent-soft text-text"
                }`}
              >
                {idx !== -1 && <span className="mr-1 tnum text-accent">{idx + 1}.</span>}
                {pid}
              </button>
            );
          })}
        </div>
      </div>
      {err && <div className="mt-2 text-[12px] text-danger">{err}</div>}
      <div className="mt-3 flex justify-end">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save alias"}</Button>
      </div>
    </form>
  );
}
