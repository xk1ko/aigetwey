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

// Provider presets — pick a type first, which prefills Base URL + API Type, then
// you only fill Name + Key. Mirrors 9router's per-type forms but friendlier; the
// fields below are still 9router's (Name, API Type, Base URL, Key + Check, Model
// ID), minus the separate Prefix — our Name is the id and the model prefix.
type Preset = { id: string; label: string; sub: string; icon: string; format: WireFormat; base_url: string };
const PRESETS: Preset[] = [
  { id: "openai", label: "OpenAI", sub: "compatible /v1", icon: "bolt", format: "openai", base_url: "https://api.openai.com/v1" },
  { id: "anthropic", label: "Anthropic", sub: "Claude messages", icon: "smart_toy", format: "anthropic", base_url: "https://api.anthropic.com" },
  { id: "gemini", label: "Gemini", sub: "Google AI", icon: "auto_awesome", format: "gemini", base_url: "https://generativelanguage.googleapis.com" },
  { id: "openrouter", label: "OpenRouter", sub: "many models", icon: "hub", format: "openai", base_url: "https://openrouter.ai/api/v1" },
  { id: "groq", label: "Groq", sub: "fast inference", icon: "speed", format: "openai", base_url: "https://api.groq.com/openai/v1" },
  { id: "custom", label: "Custom", sub: "blank form", icon: "tune", format: "openai", base_url: "" },
];

function AddProviderForm({ onDone }: { onDone: () => void }) {
  const [preset, setPreset] = useState<Preset | null>(null);
  const [id, setId] = useState("");
  const [format, setFormat] = useState<WireFormat>("openai");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [free, setFree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<null | "ok" | "fail">(null);
  const [err, setErr] = useState("");

  function choosePreset(p: Preset) {
    setPreset(p);
    setFormat(p.format);
    setBaseUrl(p.base_url);
    setCheckResult(null);
    setErr("");
    if (!id && p.id !== "custom") setId(p.id);
  }

  // step 1: pick a type. base_url + format come from the preset.
  if (!preset) {
    return (
      <div className="mb-5 rounded-brand-lg border border-border bg-surface p-4 shadow-soft">
        <span className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">New provider — pick a type</span>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => choosePreset(p)}
              className="flex flex-col items-start gap-1.5 rounded-brand border border-border bg-bg p-3 text-left transition-colors hover:border-accent hover:bg-accent-soft"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-brand bg-surface-2 text-text-muted">
                <Icon name={p.icon} size={17} />
              </span>
              <span className="text-[13px] font-semibold text-text">{p.label}</span>
              <span className="text-[11px] text-text-subtle">{p.sub}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  async function check() {
    if (!baseUrl) {
      setErr("base URL required to check");
      return;
    }
    setChecking(true);
    setCheckResult(null);
    const r = await adminApi.validateProvider({ format, base_url: baseUrl, api_key: apiKey || undefined });
    setChecking(false);
    setCheckResult(r.ok && r.data?.reachable ? "ok" : "fail");
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
    <form onSubmit={submit} className="mb-5 rounded-brand-lg border border-border bg-surface p-4 shadow-soft">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-brand bg-surface-2 text-text-muted">
          <Icon name={preset.icon} size={15} />
        </span>
        <span className="text-[13px] font-semibold text-text">{preset.label}</span>
        <button
          type="button"
          onClick={() => { setPreset(null); setCheckResult(null); }}
          className="ml-auto inline-flex items-center gap-1 text-[12px] text-text-subtle hover:text-text"
        >
          <Icon name="arrow_back" size={14} /> change type
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" hint="the id — also the model prefix (id/model)">
          <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. openai, Huki" />
        </Field>
        <Field label="API Type" hint="the wire format this endpoint speaks">
          <Select value={format} onChange={(e) => setFormat(e.target.value as WireFormat)}>
            <option value="openai">OpenAI — /v1/chat/completions</option>
            <option value="anthropic">Anthropic — /v1/messages</option>
            <option value="gemini">Gemini</option>
          </Select>
        </Field>
        <Field label="Base URL" hint="ending in /v1 for an OpenAI-compatible API">
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
        </Field>
        <Field label="API Key" hint={free ? "not needed — free / no-auth" : "optional; used for Check + requests"}>
          <div className="flex gap-2">
            <Input
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setCheckResult(null); }}
              placeholder="sk-…"
              disabled={free}
              className="flex-1"
            />
            <Button type="button" variant="ghost" disabled={checking || !baseUrl} onClick={check}>
              {checking ? "Checking…" : "Check"}
            </Button>
          </div>
        </Field>
        <Field label="Model ID" hint="optional — seed one model id (provider lacks /models)">
          <Input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="e.g. gpt-4o" />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-text-muted">
          <Checkbox checked={free} onChange={() => setFree((v) => !v)} ariaLabel="Free passthrough" />
          Free passthrough (no upstream auth)
        </label>
        {checkResult && <Badge tone={checkResult === "ok" ? "live" : "down"}>{checkResult === "ok" ? "reachable" : "unreachable"}</Badge>}
      </div>

      {err && <div className="mt-2 text-[12px] text-danger">{err}</div>}
      <div className="mt-3 flex justify-end">
        <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add provider"}</Button>
      </div>
    </form>
  );
}
