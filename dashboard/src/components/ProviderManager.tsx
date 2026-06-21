"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { adminApi } from "@/lib/client";
import { Lamp } from "@/components/Lamp";
import { Badge, FormatBadge } from "@/components/Badge";
import { CooldownTimer } from "@/components/CooldownTimer";
import { Button, Input, Select, Field } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { fmt, Empty } from "@/components/ui";
import type { MaskedConfig, ProviderSnapshot, QuotaSnapshot, WireFormat } from "@/lib/gateway";

interface Loaded {
  config: MaskedConfig;
  health: ProviderSnapshot[];
  quota: QuotaSnapshot[];
}

export function ProviderManager() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    const [cfg, prov, q] = await Promise.all([
      fetch("/api/gw/admin/config"),
      adminApi.providers(),
      adminApi.quota(),
    ]);
    if (!cfg.ok || !prov.ok) {
      setError("could not reach the gateway");
      return;
    }
    setError("");
    setData({
      config: (await cfg.json()) as MaskedConfig,
      health: prov.data?.providers ?? [],
      quota: q.data?.quota ?? [],
    });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (error) return <Empty>{error}</Empty>;
  if (!data) return <Empty>Loading…</Empty>;

  const healthById = new Map(data.health.map((h) => [h.id, h]));
  const quotaById = new Map(data.quota.map((q) => [q.provider, q]));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-text">Providers &amp; Keys</h1>
          <p className="mt-1 text-[13px] text-text-muted">Upstream providers the gateway routes to.</p>
        </div>
        <Button onClick={() => setAdding((v) => !v)}>
          <Icon name={adding ? "close" : "add"} size={17} />
          {adding ? "Cancel" : "Add provider"}
        </Button>
      </div>

      {adding && <AddProviderForm onDone={() => { setAdding(false); void reload(); }} />}

      {data.config.providers.length === 0 ? (
        <Empty>No providers yet. Add one to start routing.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.config.providers.map((p) => {
            const health = healthById.get(p.id);
            const healthy = health ? health.keys.some((k) => k.healthy) : true;
            const cooling = health?.keys.find((k) => !k.healthy && k.cooldown_ms > 0);
            const q = quotaById.get(p.id);
            return (
              <Link
                key={p.id}
                href={`/providers/${encodeURIComponent(p.id)}`}
                className="group rounded-brand-lg border border-border bg-surface p-4 shadow-soft transition-colors hover:border-text-subtle"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Lamp state={healthy ? "live" : "down"} />
                    <span className="truncate text-[14px] font-semibold text-text">{p.id}</span>
                  </div>
                  <FormatBadge format={p.format} />
                </div>
                <div className="mt-2 truncate text-[12px] text-text-subtle">{p.base_url}</div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {p.free && <Badge tone="info">free</Badge>}
                  {p.service_account && <Badge tone="info">service-account</Badge>}
                  <Badge tone="neutral">
                    {p.free || p.service_account ? `${(p.api_keys?.length ?? 0)} keys` : `${p.api_keys?.length ?? (p.api_key ? 1 : 0)} keys`}
                  </Badge>
                  <Badge tone="neutral">{p.models.length} models</Badge>
                  {cooling && <CooldownTimer ms={cooling.cooldown_ms} />}
                </div>
                {q && (
                  <div className="mt-3 border-t border-border-subtle pt-2.5">
                    <div className="flex items-center justify-between text-[11px] text-text-subtle">
                      <span>quota · {q.window}</span>
                      <CooldownTimer ms={q.reset_in_ms} tone="muted" icon="restart_alt" keepZero />
                    </div>
                    {q.limit_tokens && (
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className={`h-full ${q.exhausted ? "bg-danger" : "bg-accent"}`}
                          style={{ width: `${Math.round((q.pct ?? 0) * 100)}%` }}
                        />
                      </div>
                    )}
                    <div className="mt-1 tnum text-[11px] text-text-muted">
                      {fmt.compact(q.consumed)}
                      {q.limit_tokens ? ` / ${fmt.compact(q.limit_tokens)}` : ""} tokens
                    </div>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AddProviderForm({ onDone }: { onDone: () => void }) {
  const [id, setId] = useState("");
  const [format, setFormat] = useState<WireFormat>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [free, setFree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await adminApi.addProvider({
      id,
      format,
      base_url: baseUrl,
      api_key: apiKey || undefined,
      free,
    });
    setBusy(false);
    if (res.ok) onDone();
    else setErr(res.error ?? "failed");
  }

  return (
    <form onSubmit={submit} className="mb-5 rounded-brand-lg border border-border bg-surface p-4 shadow-soft">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ID"><Input value={id} onChange={(e) => setId(e.target.value)} placeholder="openai" /></Field>
        <Field label="Format">
          <Select value={format} onChange={(e) => setFormat(e.target.value as WireFormat)}>
            <option value="openai">openai</option>
            <option value="anthropic">anthropic</option>
            <option value="gemini">gemini</option>
          </Select>
        </Field>
        <Field label="Base URL">
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
        </Field>
        <Field label="API key" hint={free ? "not needed for free" : "optional"}>
          <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" disabled={free} />
        </Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-[12px] text-text-muted">
        <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />
        Free passthrough (no upstream auth)
      </label>
      {err && <div className="mt-2 text-[12px] text-danger">{err}</div>}
      <div className="mt-3 flex justify-end">
        <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add provider"}</Button>
      </div>
    </form>
  );
}
