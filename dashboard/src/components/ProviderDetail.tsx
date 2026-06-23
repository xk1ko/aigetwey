"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { adminApi } from "@/lib/client";
import { Lamp } from "@/components/Lamp";
import { Badge, FormatBadge } from "@/components/Badge";
import { CooldownTimer } from "@/components/CooldownTimer";
import { RichCard, CardTitle } from "@/components/RichCard";
import { Button, Input } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { fmt, Empty } from "@/components/ui";
import { ModelSelectModal, type DiscoveredModel } from "@/components/ModelSelectModal";
import { KeyReveal } from "@/components/KeyReveal";
import type { MaskedConfig, MaskedProvider, ProviderSnapshot, PingResult } from "@/lib/gateway";

export function ProviderDetail({ id }: { id: string }) {
  const router = useRouter();
  const [provider, setProvider] = useState<MaskedProvider | null>(null);
  const [health, setHealth] = useState<ProviderSnapshot | null>(null);
  const [error, setError] = useState("");
  const [ping, setPing] = useState<PingResult | null>(null);
  const [busy, setBusy] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newModel, setNewModel] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [discovered, setDiscovered] = useState<DiscoveredModel[] | null>(null);
  const [modelTest, setModelTest] = useState<Record<string, "testing" | "ok" | "fail">>({});

  async function testModel(mid: string) {
    setModelTest((t) => ({ ...t, [mid]: "testing" }));
    const r = await adminApi.testModel(id, mid);
    setModelTest((t) => ({ ...t, [mid]: r.ok && r.data?.ok ? "ok" : "fail" }));
  }

  const reload = useCallback(async () => {
    const [cfgRes, provRes] = await Promise.all([fetch("/api/gw/admin/config"), adminApi.providers()]);
    if (!cfgRes.ok) {
      setError("could not reach the gateway");
      return;
    }
    const cfg = (await cfgRes.json()) as MaskedConfig;
    const p = cfg.providers.find((x) => x.id === id) ?? null;
    if (!p) {
      setError(`provider "${id}" not found`);
      return;
    }
    setError("");
    setProvider(p);
    setHealth(provRes.data?.providers.find((x) => x.id === id) ?? null);
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (error) return <Empty>{error}</Empty>;
  if (!provider) return <Empty>Loading…</Empty>;

  const keys = provider.api_keys ?? (provider.api_key ? [provider.api_key] : []);
  const q = modelFilter.trim().toLowerCase();
  const shownModels = q ? provider.models.filter((m) => m.id.toLowerCase().includes(q)) : provider.models;

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(label);
    const res = await fn();
    setBusy("");
    if (!res.ok) setError(res.error ?? "action failed");
    else {
      setError("");
      await reload();
    }
  }

  return (
    <div>
      <button onClick={() => router.push("/providers")} className="mb-4 inline-flex items-center gap-1 text-[12px] text-text-muted hover:text-text">
        <Icon name="arrow_back" size={15} /> Providers
      </button>

      <div className="mb-6 flex items-center gap-3">
        <Lamp state={health?.keys.some((k) => k.healthy) ?? true ? "live" : "down"} />
        <h1 className="text-[22px] font-semibold tracking-tight text-text">{provider.id}</h1>
        <FormatBadge format={provider.format} />
        {provider.free && <Badge tone="info">free</Badge>}
        {provider.service_account && <Badge tone="info">service-account</Badge>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RichCard header={<CardTitle title="Connection" />}>
          <div className="space-y-2 text-[13px]">
            <Row k="Base URL" v={provider.base_url} />
            <Row k="Format" v={provider.format} />
            <Row k="Cooldown base" v={`${provider.cooldown_base_ms}ms`} />
            <Row k="Max retries" v={String(provider.max_retries)} />
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button variant="ghost" disabled={busy === "test"} onClick={() => run("test", async () => {
              const r = await adminApi.testProvider(id);
              if (r.ok) setPing(r.data);
              return r;
            })}>
              <Icon name="wifi_tethering" size={16} /> {busy === "test" ? "Testing…" : "Test connection"}
            </Button>
            <Button variant="ghost" disabled={busy === "discover"} onClick={() => run("discover", async () => {
              const r = await adminApi.discoverModels(id);
              if (r.ok) setDiscovered(r.data?.models ?? []);
              return r;
            })}>
              <Icon name="sync" size={16} /> {busy === "discover" ? "Fetching…" : "Fetch models"}
            </Button>
          </div>
          {ping && (
            <div className="mt-3 text-[12px]">
              <Badge tone={ping.ok ? "live" : ping.reachable ? "warn" : "down"}>
                {ping.ok ? `ok (${ping.status})` : ping.reachable ? `reachable (${ping.status})` : "unreachable"}
              </Badge>
              {ping.error && <span className="ml-2 text-text-subtle">{ping.error}</span>}
            </div>
          )}
        </RichCard>

        <RichCard header={<CardTitle title="Keys" sub={`${keys.length} configured`} />}>
          {keys.length === 0 ? (
            <Empty>No keys (free / service-account provider).</Empty>
          ) : (
            <div className="space-y-1.5">
              {keys.map((k, i) => {
                const ks = health?.keys[i];
                return (
                  <div key={i} className="flex items-center justify-between rounded-brand border border-border-subtle px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Lamp state={ks ? (ks.healthy ? "live" : "down") : "idle"} />
                      <KeyReveal
                        masked={k}
                        reveal={async () => {
                          const r = await adminApi.revealKey(id, i);
                          return r.ok ? r.data?.key ?? null : null;
                        }}
                      />
                      {ks && ks.cooldown_ms > 0 && <CooldownTimer ms={ks.cooldown_ms} />}
                    </div>
                    <button
                      onClick={() => run(`rmkey${i}`, () => adminApi.removeKey(id, i))}
                      className="text-text-subtle hover:text-danger"
                      aria-label="Remove key"
                    >
                      <Icon name="delete" size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="add a key…" />
            <Button disabled={!newKey || busy === "addkey"} onClick={() => run("addkey", async () => {
              const r = await adminApi.addKey(id, newKey);
              if (r.ok) setNewKey("");
              return r;
            })}>Add</Button>
          </div>
        </RichCard>

        <RichCard
          className="lg:col-span-2"
          header={
            <>
              <CardTitle title="Models served" sub={`${provider.models.length} in catalog`} />
              {provider.models.length > 0 && (
                <button
                  onClick={() => run("clear", () => adminApi.clearModels(id))}
                  disabled={busy === "clear"}
                  className="text-[12px] text-text-subtle hover:text-danger"
                >
                  Clear all
                </button>
              )}
            </>
          }
        >
          {provider.models.length === 0 ? (
            <Empty>No models. Add one below, or fetch them for a free/auto provider.</Empty>
          ) : (
            <>
              <p className="mb-2.5 text-[12px] text-text-subtle">
                Call any of these as <span className="tnum text-text-muted">{provider.id}/&lt;model&gt;</span>, as a combo alias, or by the bare id.
              </p>
              {/* filter only earns its space once the catalog is long enough to scroll */}
              {provider.models.length > 8 && (
                <div className="mb-2.5 flex items-center gap-2">
                  <div className="relative flex-1">
                    <Icon name="search" size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-subtle" />
                    <Input value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} placeholder="filter models…" className="pl-8" />
                  </div>
                  <span className="tnum whitespace-nowrap text-[12px] text-text-subtle">
                    {q ? `${shownModels.length} of ${provider.models.length}` : `${provider.models.length}`}
                  </span>
                </div>
              )}
              {shownModels.length === 0 ? (
                <Empty>No model matches “{modelFilter}”.</Empty>
              ) : (
                <div className="max-h-[360px] divide-y divide-border-subtle overflow-y-auto rounded-brand border border-border-subtle">
                  {shownModels.map((m) => {
                    const st = modelTest[m.id];
                    const statusIcon = st === "ok" ? "check_circle" : st === "fail" ? "cancel" : "smart_toy";
                    const statusColor = st === "ok" ? "text-success" : st === "fail" ? "text-danger" : "text-text-subtle";
                    return (
                      <div key={m.id} className="group flex items-center justify-between gap-3 px-3 py-2 hover:bg-bg">
                        <div className="flex min-w-0 items-center gap-2">
                          <Icon name={statusIcon} size={15} className={`flex-none ${statusColor}`} />
                          {/* the prefix (= provider id) is what makes the call string; show it like 9router */}
                          <span className="tnum truncate text-[12.5px]">
                            <span className="text-text-subtle">{provider.id}/</span>
                            <span className="text-text">{m.id}</span>
                          </span>
                          {(m.price_in !== undefined || m.price_out !== undefined) && (
                            <span className="tnum whitespace-nowrap text-[11px] text-text-subtle">
                              {fmt.cost(m.price_in ?? 0)}/{fmt.cost(m.price_out ?? 0)} per 1M
                            </span>
                          )}
                        </div>
                        <div className="flex flex-none items-center gap-0.5">
                          <button
                            onClick={() => testModel(m.id)}
                            disabled={st === "testing"}
                            className="rounded p-1 text-text-subtle transition-colors hover:bg-surface hover:text-accent disabled:opacity-60"
                            aria-label={`Test ${m.id}`}
                            title={st === "fail" ? "Test failed — click to retry" : "Test this model"}
                          >
                            <Icon name={st === "testing" ? "progress_activity" : "science"} size={15} />
                          </button>
                          <button
                            onClick={() => run(`rmmodel${m.id}`, () => adminApi.removeModel(id, m.id))}
                            disabled={busy === `rmmodel${m.id}`}
                            className="rounded p-1 text-text-subtle transition-colors hover:bg-surface hover:text-danger disabled:opacity-40"
                            aria-label={`Remove ${m.id}`}
                          >
                            <Icon name="delete" size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
          <div className="mt-3 flex gap-2">
            <Input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder="add a model id…" />
            <Button disabled={!newModel || busy === "addmodel"} onClick={() => run("addmodel", async () => {
              const r = await adminApi.addModel(id, newModel);
              if (r.ok) setNewModel("");
              return r;
            })}>Add</Button>
          </div>
        </RichCard>
      </div>

      {discovered && (
        <ModelSelectModal
          models={discovered}
          busy={busy === "addmodels"}
          onClose={() => setDiscovered(null)}
          onAdd={(ids) => run("addmodels", async () => {
            const r = await adminApi.addModels(id, ids);
            if (r.ok) setDiscovered(null);
            return r;
          })}
        />
      )}

      <div className="mt-6">
        <Button variant="danger" disabled={busy === "rmprov"} onClick={() => run("rmprov", async () => {
          const r = await adminApi.removeProvider(id);
          if (r.ok) router.push("/providers");
          return r;
        })}>
          <Icon name="delete" size={16} /> Remove provider
        </Button>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-subtle">{k}</span>
      <span className="truncate text-text">{v}</span>
    </div>
  );
}
