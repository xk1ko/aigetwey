"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { adminApi } from "@/lib/client";
import { Lamp } from "@/components/Lamp";
import { Badge, FormatBadge } from "@/components/Badge";
import { CooldownTimer } from "@/components/CooldownTimer";
import { Button, Input, Select, Field } from "@/components/Button";
import { Checkbox } from "@/components/Checkbox";
import { Icon } from "@/components/Icon";
import { fmt, Empty } from "@/components/ui";
import type { MaskedConfig, PingResult, ProviderSnapshot, QuotaSnapshot, WireFormat } from "@/lib/gateway";

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
        <Button onClick={() => setAdding(true)}>
          <Icon name="add" size={17} />
          Add provider
        </Button>
      </div>

      {adding && (
        <AddProviderForm
          onClose={() => setAdding(false)}
          onDone={() => { setAdding(false); void reload(); }}
        />
      )}

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

// Provider presets — pick a type first, which prefills Base URL + API Type, then
// you only fill Name + Key. Mirrors 9router's per-type forms but friendlier; the
// fields below are still 9router's (Name, API Type, Base URL, Key + Check, Model
// ID), minus the separate Prefix — our Name is the id and the model prefix.
type Preset = { id: string; label: string; sub: string; icon: string; format: WireFormat; base_url: string; hint: string; modelHint: string };
const PRESETS: Preset[] = [
  {
    id: "openai", label: "OpenAI compatible", sub: "/v1/chat/completions", icon: "bolt",
    format: "openai", base_url: "https://api.openai.com/v1",
    hint: "Base URL ending in /v1 for any OpenAI-compatible API.", modelHint: "e.g. gpt-4o, glm-5.2",
  },
  {
    id: "anthropic", label: "Anthropic compatible", sub: "/v1/messages", icon: "smart_toy",
    format: "anthropic", base_url: "https://api.anthropic.com",
    hint: "Base URL of an Anthropic-compatible API; /messages is appended.", modelHint: "e.g. claude-sonnet-4-6",
  },
];

/** Centered modal shell (overlay + click-outside), matching 9router's add flow. */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-6 sm:p-10" onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-brand-lg border border-border bg-surface shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3.5">
          <h2 className="text-[14px] font-semibold text-text">{title}</h2>
          <button onClick={onClose} className="text-text-subtle hover:text-text" aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function AddProviderForm({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [preset, setPreset] = useState<Preset | null>(null);
  const [id, setId] = useState("");
  const [format, setFormat] = useState<WireFormat>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [modelId, setModelId] = useState("");
  const [free, setFree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkRes, setCheckRes] = useState<PingResult | null>(null);
  const [err, setErr] = useState("");

  function choosePreset(p: Preset) {
    setPreset(p);
    setFormat(p.format);
    setBaseUrl(p.base_url);
    setCheckRes(null);
    setErr("");
    if (!id) setId(p.id);
  }

  // step 1: pick a type (OpenAI- or Anthropic-compatible). It prefills Base URL
  // + API Type; only Name + Key remain.
  if (!preset) {
    return (
      <Modal title="Add a provider" onClose={onClose}>
        <p className="text-[12.5px] text-text-muted">Pick the API your endpoint speaks — the rest is prefilled.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => choosePreset(p)}
              className="group flex items-start gap-3 rounded-brand-lg border border-border bg-bg p-4 text-left transition-colors hover:border-accent hover:bg-accent-soft"
            >
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-brand bg-surface-2 text-text-muted group-hover:text-accent">
                <Icon name={p.icon} size={20} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-text">{p.label}</span>
                <span className="block tnum text-[11.5px] text-text-subtle">{p.sub}</span>
                <span className="mt-1 block text-[11.5px] text-text-muted">{p.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  async function check() {
    if (!baseUrl) {
      setErr("base URL required to check");
      return;
    }
    setChecking(true);
    setCheckRes(null);
    const r = await adminApi.validateProvider({ format, base_url: baseUrl, api_key: apiKey || undefined });
    setChecking(false);
    setCheckRes(r.data ?? { ok: false, reachable: false, status: 0, error: r.error });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !baseUrl) {
      setErr("name and base URL are required");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await adminApi.addProvider({ id, format, base_url: baseUrl, api_key: apiKey || undefined, free });
    if (!res.ok) {
      setBusy(false);
      setErr(res.error ?? "failed");
      return;
    }
    // optional seed model, like 9router's "Model ID (optional)" field
    if (modelId.trim()) await adminApi.addModel(id, modelId.trim());
    setBusy(false);
    onDone();
  }

  return (
    <Modal title={`Add ${preset.label}`} onClose={onClose}>
    <form onSubmit={submit}>
      <button
        type="button"
        onClick={() => { setPreset(null); setCheckRes(null); }}
        className="mb-3 inline-flex items-center gap-1 text-[12px] text-text-subtle hover:text-text"
      >
        <Icon name="arrow_back" size={14} /> change type
      </button>

      {/* identity */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" hint="the id — also the model prefix (name/model)">
          <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. openai, Huki" />
        </Field>
        <Field label="API Type" hint="wire format this endpoint speaks">
          <Select value={format} onChange={(e) => setFormat(e.target.value as WireFormat)}>
            <option value="openai">OpenAI — /v1/chat/completions</option>
            <option value="anthropic">Anthropic — /v1/messages</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Base URL" hint={preset.hint}>
            <Input value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setCheckRes(null); }} placeholder={preset.base_url} className="font-mono text-[12.5px]" />
          </Field>
        </div>
      </div>

      {/* credentials + check */}
      <div className="mt-4 border-t border-border-subtle pt-4">
        <Field label="API Key" hint={free ? "not needed — free / no-auth" : "used for Check and for live requests"}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setCheckRes(null); }}
                placeholder="sk-…"
                disabled={free}
                className="font-mono text-[12.5px] pr-9"
              />
              {apiKey && (
                <button type="button" onClick={() => setShowKey((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-subtle hover:text-text" aria-label={showKey ? "Hide key" : "Show key"}>
                  <Icon name={showKey ? "visibility_off" : "visibility"} size={15} />
                </button>
              )}
            </div>
            <Button type="button" variant="ghost" disabled={checking || !baseUrl} onClick={check}>
              <Icon name={checking ? "progress_activity" : "wifi_tethering"} size={15} />
              {checking ? "Checking…" : "Check"}
            </Button>
          </div>
        </Field>
        {checkRes && (
          <div className="mt-2 flex items-center gap-2 text-[12px]">
            <Badge tone={checkRes.ok ? "live" : checkRes.reachable ? "warn" : "down"}>
              {checkRes.ok ? "valid" : checkRes.reachable ? `reachable (${checkRes.status})` : "invalid"}
            </Badge>
            {checkRes.error && <span className="text-text-subtle">{checkRes.error}</span>}
          </div>
        )}
      </div>

      {/* optional seed model + free toggle */}
      <div className="mt-4 grid items-end gap-3 border-t border-border-subtle pt-4 sm:grid-cols-2">
        <Field label="Model ID" hint="optional — seed one if the provider has no /models">
          <Input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder={preset.modelHint} className="font-mono text-[12.5px]" />
        </Field>
        <label className="flex cursor-pointer items-center gap-2 pb-2 text-[12.5px] text-text-muted">
          <Checkbox checked={free} onChange={() => setFree((v) => !v)} ariaLabel="Free passthrough" />
          Free passthrough (no upstream auth)
        </label>
      </div>

      {id && (
        <p className="mt-3 text-[12px] text-text-subtle">
          Models will be callable as <span className="tnum text-text-muted">{id}/&lt;model&gt;</span>.
        </p>
      )}
      {err && <div className="mt-2 text-[12px] text-danger">{err}</div>}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add provider"}</Button>
      </div>
    </form>
    </Modal>
  );
}
