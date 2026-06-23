"use client";

import { useEffect, useState, useCallback } from "react";
import { adminApi } from "@/lib/client";
import { Lamp } from "@/components/Lamp";
import { Badge } from "@/components/Badge";
import { RichCard, CardTitle } from "@/components/RichCard";
import { Button, Input, Select, Field } from "@/components/Button";
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
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-text">Combos &amp; Routing</h1>
          <p className="mt-1 text-[13px] text-text-muted">
            A combo is an alias your CLI tool calls, routed to a chain of providers. Fallback tries them in order; round-robin spreads load.
          </p>
        </div>
        <Button onClick={() => setAdding((v) => !v)}>
          <Icon name={adding ? "close" : "add"} size={17} />
          {adding ? "Cancel" : "Add combo"}
        </Button>
      </div>

      {adding && (
        <RouteForm
          providers={config.providers}
          onDone={() => { setAdding(false); void reload(); }}
        />
      )}

      {config.models.length === 0 ? (
        <Empty>No combos yet. Add one to expose a model alias to your CLI tools.</Empty>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {config.models.map((route) => (
            <RichCard
              key={route.alias}
              header={
                <>
                  <CardTitle title={route.alias} sub={`${route.target.length} in chain`} />
                  <div className="flex items-center gap-2">
                    <Badge tone={route.strategy === "round-robin" ? "info" : "neutral"}>{route.strategy}</Badge>
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

// Combo create form, modeled on 9router's ComboFormModal: a name + ONE ordered
// list of concrete `provider/model` entries (fallback priority), picked from the
// providers' catalogs. On save each entry splits into target[i]/model[i].
type ProviderOption = { id: string; models: { id: string }[] };

function RouteForm({ providers, onDone }: { providers: ProviderOption[]; onDone: () => void }) {
  const [alias, setAlias] = useState("");
  const [entries, setEntries] = useState<string[]>([]); // "provider/model"
  const [provPick, setProvPick] = useState("");
  const [modelPick, setModelPick] = useState("");
  const [strategy, setStrategy] = useState<"fallback" | "round-robin">("fallback");
  const [priceIn, setPriceIn] = useState("");
  const [priceOut, setPriceOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // two cascading dropdowns: provider first, then its catalog models (minus the
  // ones already in the chain). No free typing → no typos, no native datalist.
  const selectedProvider = providers.find((p) => p.id === provPick);
  const modelOptions = selectedProvider
    ? selectedProvider.models.filter((m) => !entries.includes(`${provPick}/${m.id}`))
    : [];

  function add() {
    if (!provPick || !modelPick) return;
    const v = `${provPick}/${modelPick}`;
    if (!entries.includes(v)) setEntries((e) => [...e, v]);
    setModelPick("");
    setErr("");
  }

  // reorder fallback priority: dropping entry #from onto slot #to
  function move(from: number, to: number) {
    setEntries((e) => {
      const next = [...e];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!alias || entries.length === 0) {
      setErr("a name and at least one model are required");
      return;
    }
    setBusy(true);
    setErr("");
    const target = entries.map((x) => x.slice(0, x.indexOf("/")));
    const model = entries.map((x) => x.slice(x.indexOf("/") + 1));
    const r = await adminApi.setRoute(alias, {
      target,
      model,
      strategy,
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
        <Field label="Name" hint="the model name your CLI calls">
          <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="claude-sonnet-4-6" />
        </Field>
        <Field label="Strategy" hint="how the chain is tried">
          <Select value={strategy} onChange={(e) => setStrategy(e.target.value as "fallback" | "round-robin")}>
            <option value="fallback">Fallback — try in order, next on failure</option>
            <option value="round-robin">Round Robin — rotate to spread load</option>
          </Select>
        </Field>
        <Field label="Price in" hint="per 1M, optional"><Input value={priceIn} onChange={(e) => setPriceIn(e.target.value)} placeholder="3" /></Field>
        <Field label="Price out" hint="per 1M, optional"><Input value={priceOut} onChange={(e) => setPriceOut(e.target.value)} placeholder="15" /></Field>
      </div>

      <div className="mt-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">
          Models — add provider/model in fallback order
        </span>
        <div className="mt-1.5 flex gap-2">
          <Select
            value={provPick}
            onChange={(e) => { setProvPick(e.target.value); setModelPick(""); }}
            className="flex-1"
          >
            <option value="">Provider…</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
          </Select>
          <Select
            value={modelPick}
            onChange={(e) => setModelPick(e.target.value)}
            disabled={!provPick}
            className="flex-1"
          >
            <option value="">{provPick ? "Model…" : "pick provider first"}</option>
            {modelOptions.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
          </Select>
          <Button type="button" variant="ghost" disabled={!provPick || !modelPick} onClick={add}>
            <Icon name="add" size={16} /> Add
          </Button>
        </div>
        {provPick && selectedProvider && selectedProvider.models.length === 0 && (
          <div className="mt-1.5 text-[11px] text-warning">
            “{provPick}” has no models cached — open it under Providers and Fetch models first.
          </div>
        )}

        {entries.length === 0 ? (
          <div className="mt-2 rounded-brand border border-dashed border-border-subtle px-3 py-4 text-center text-[12px] text-text-subtle">
            No models yet. Pick a <span className="tnum">provider</span> then a <span className="tnum">model</span> above and hit Add.
          </div>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {entries.map((entry, i) => (
              <li
                key={entry}
                draggable
                onDragStart={() => setDragIdx(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIdx !== null && dragIdx !== i) move(dragIdx, i);
                  setDragIdx(null);
                }}
                onDragEnd={() => setDragIdx(null)}
                className={`flex cursor-grab items-center gap-2.5 rounded-brand border px-3 py-2 active:cursor-grabbing ${
                  dragIdx === i ? "border-accent bg-accent-soft" : "border-border-subtle"
                }`}
              >
                <Icon name="drag_indicator" size={16} className="text-text-subtle" />
                <span className="tnum text-[11px] text-text-subtle">{i === 0 ? "primary" : `#${i + 1}`}</span>
                <span className="tnum truncate text-[13px] text-text">{entry}</span>
                <button
                  type="button"
                  onClick={() => setEntries((e) => e.filter((_, idx) => idx !== i))}
                  className="ml-auto flex-none text-text-subtle hover:text-danger"
                  aria-label={`Remove ${entry}`}
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {err && <div className="mt-2 text-[12px] text-danger">{err}</div>}
      <div className="mt-3 flex justify-end">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save combo"}</Button>
      </div>
    </form>
  );
}
