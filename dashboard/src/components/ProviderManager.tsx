"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { adminApi } from "@/lib/client";
import { Lamp } from "@/components/Lamp";
import { Badge, FormatBadge } from "@/components/Badge";
import { CooldownTimer } from "@/components/CooldownTimer";
import { Button, Input, Field } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Empty } from "@/components/ui";
import type { MaskedConfig, PingResult, ProviderSnapshot, WireFormat } from "@/lib/gateway";

interface Loaded {
  config: MaskedConfig;
  health: ProviderSnapshot[];
}

export function ProviderManager() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [providerOrder, setProviderOrder] = useState<string[]>([]);

  const reload = useCallback(async () => {
    const [cfg, prov] = await Promise.all([
      fetch("/api/gw/admin/config"),
      adminApi.providers(),
    ]);
    if (!cfg.ok || !prov.ok) {
      setError("could not reach the gateway");
      return;
    }
    setError("");
    const loaded: Loaded = {
      config: (await cfg.json()) as MaskedConfig,
      health: prov.data?.providers ?? [],
    };
    setData(loaded);
    setProviderOrder(loaded.config.providers.map((p) => p.id));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || !data) return;

    const oldIndex = providerOrder.indexOf(active.id as string);
    const newIndex = providerOrder.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;

    setProviderOrder(arrayMove(providerOrder, oldIndex, newIndex));
    await adminApi.reorderProvider(oldIndex, newIndex);
    void reload();
  }

  if (error) return <Empty>{error}</Empty>;
  if (!data) return <Empty>Loading…</Empty>;

  const healthById = new Map(data.health.map((h) => [h.id, h]));
  const providerMap = new Map(data.config.providers.map((p) => [p.id, p]));
  const orderedProviders = providerOrder
    .map((id) => providerMap.get(id))
    .filter(Boolean) as typeof data.config.providers;

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

      {orderedProviders.length === 0 ? (
        <Empty>No providers yet. Add one to start routing.</Empty>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={providerOrder} strategy={rectSortingStrategy}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {orderedProviders.map((p) => {
                const health = healthById.get(p.id);
                const healthy = health ? health.keys.some((k) => k.healthy) : true;
                const cooling = health?.keys.find((k) => !k.healthy && k.cooldown_ms > 0);
                return (
                  <SortableProviderCard
                    key={p.id}
                    p={p}
                    healthy={healthy}
                    cooling={cooling}
                    onDone={reload}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

type ProviderConfig = MaskedConfig["providers"][number];

function SortableProviderCard({
  p,
  healthy,
  cooling,
  onDone,
}: {
  p: ProviderConfig;
  healthy: boolean;
  cooling: { cooldown_ms: number } | undefined;
  onDone: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: p.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative rounded-brand-lg border bg-surface shadow-soft transition-colors ${
        isDragging ? "opacity-50 border-accent shadow-elevated z-10" : ""
      } ${
        p.disabled
          ? "border-danger/35 opacity-60 hover:opacity-100 hover:border-danger/60"
          : isDragging ? "" : "border-border hover:border-text-subtle"
      }`}
    >
      {/* drag pill — centered top, visible on hover */}
      <div
        {...attributes}
        {...listeners}
        className="absolute inset-x-0 top-0 flex h-5 cursor-grab items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
        onClick={(e) => e.preventDefault()}
      >
        <span className="h-[3px] w-8 rounded-full bg-border-subtle transition-colors group-hover:bg-text-subtle" />
      </div>

      <Link
        href={`/providers/${encodeURIComponent(p.id)}`}
        className="block p-4 pt-5"
        draggable={false}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Lamp state={p.disabled ? "idle" : healthy ? "live" : "down"} />
            <div className="min-w-0">
              <span className="block truncate text-[14px] font-semibold text-text">{p.name || p.id}</span>
              {p.name && <span className="block truncate text-[11px] text-text-subtle">{p.id}/</span>}
            </div>
          </div>
          <FormatBadge format={p.format} />
        </div>
        <div className="mt-2 truncate text-[12px] text-text-subtle">{p.base_url}</div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ProviderToggle id={p.id} disabled={!!p.disabled} onDone={onDone} />
          {p.free && <Badge tone="info">free</Badge>}
          {p.service_account && <Badge tone="info">service-account</Badge>}
          <Badge tone="neutral">
            {p.free || p.service_account ? `${(p.api_keys?.length ?? 0)} keys` : `${p.api_keys?.length ?? (p.api_key ? 1 : 0)} keys`}
          </Badge>
          <Badge tone="neutral">{p.models.length} models</Badge>
          {cooling && <CooldownTimer ms={cooling.cooldown_ms} />}
        </div>
      </Link>
    </div>
  );
}

/**
 * Inline enable/disable switch shown on each provider card. The card is a <Link>,
 * so the button swallows the click (preventDefault + stopPropagation) to toggle in
 * place instead of navigating into the provider. `busy` ignores double-clicks.
 */
function ProviderToggle({ id, disabled, onDone }: { id: string; disabled: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (busy) return;
        setBusy(true);
        void adminApi.setProviderDisabled(id, !disabled).then(() => onDone()).finally(() => setBusy(false));
      }}
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${disabled ? "text-danger" : "text-text-muted"}`}
      aria-label={disabled ? "Enable provider" : "Disable provider"}
      title={disabled ? "Provider disabled — click to enable" : "Provider enabled — click to disable"}
    >
      <span className={`relative h-4 w-7 rounded-full transition-colors ${disabled ? "bg-danger" : "bg-accent"} ${busy ? "opacity-60" : ""}`}>
        <span className={`absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${disabled ? "translate-x-0" : "translate-x-[14px]"}`} />
      </span>
      {disabled ? "disabled" : "enabled"}
    </button>
  );
}

// Provider presets — pick a type first, which prefills Base URL + API Type, then
// you only fill Name + Key. Matches aigetwey's per-type forms but friendlier; the
// fields below are still aigetwey's (Name, API Type, Base URL, Key + Check, Model
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

function AddProviderForm({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [preset, setPreset] = useState<Preset | null>(null);
  const [id, setId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkRes, setCheckRes] = useState<PingResult | null>(null);
  const [err, setErr] = useState("");

  function choosePreset(p: Preset) {
    setPreset(p);
    setBaseUrl(p.base_url);
    setCheckRes(null);
    setErr("");
  }

  // step 1: pick a type (OpenAI- or Anthropic-compatible) — this sets the wire
  // format + base URL, exactly aigetwey's "Add OpenAI/Anthropic Compatible".
  if (!preset) {
    return (
      <div className="mb-5 rounded-brand-lg border border-border bg-surface p-5 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-text">Add a provider</h2>
            <p className="mt-0.5 text-[12.5px] text-text-muted">Pick the API your endpoint speaks — the rest is prefilled.</p>
          </div>
          <button type="button" onClick={onClose} className="flex-none text-text-subtle hover:text-text" aria-label="Cancel">
            <Icon name="close" size={18} />
          </button>
        </div>
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
      </div>
    );
  }

  async function check() {
    if (!baseUrl || !preset) return;
    setChecking(true);
    setCheckRes(null);
    const r = await adminApi.validateProvider({ format: preset.format, base_url: baseUrl, api_key: apiKey || undefined });
    setChecking(false);
    setCheckRes(r.data ?? { ok: false, reachable: false, status: 0, error: r.error });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!preset || !id || !baseUrl) {
      setErr("name and base URL are required");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await adminApi.addProvider({ id, format: preset.format, base_url: baseUrl, api_key: apiKey || undefined, free: !apiKey.trim() });
    if (!res.ok) {
      setBusy(false);
      setErr(res.error ?? "failed");
      return;
    }
    if (modelId.trim()) await adminApi.addModel(id, modelId.trim());
    setBusy(false);
    onDone();
  }

  // step 2: the aigetwey field set — Name, Base URL, API Key (for Check), Model ID.
  return (
    <div className="mb-5 rounded-brand-lg border border-border bg-surface p-5 shadow-soft">
      <form onSubmit={submit}>
        <div className="mb-4 flex items-center gap-2.5 border-b border-border-subtle pb-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-brand bg-surface-2 text-text-muted">
            <Icon name={preset.icon} size={17} />
          </span>
          <div>
            <div className="text-[13.5px] font-semibold text-text">{preset.label}</div>
            <div className="tnum text-[11px] text-text-subtle">{preset.sub}</div>
          </div>
          <button
            type="button"
            onClick={() => { setPreset(null); setCheckRes(null); }}
            className="ml-auto inline-flex items-center gap-1 text-[12px] text-text-subtle hover:text-text"
          >
            <Icon name="arrow_back" size={14} /> change type
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Name" hint="a friendly id — also the model prefix (name/model)">
            <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. openai, anthropic" />
          </Field>
          <Field label="Base URL" hint={preset.hint}>
            <Input value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setCheckRes(null); }} placeholder={preset.base_url} className="font-mono text-[12.5px]" />
          </Field>
          <Field label="API Key" hint="used for Check and live requests — leave blank for a free / no-auth endpoint">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setCheckRes(null); }}
                  placeholder="sk-…"
                  className="pr-9 font-mono text-[12.5px]"
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
            <div className="flex items-center gap-2 text-[12px]">
              <Badge tone={checkRes.ok ? "live" : checkRes.reachable ? "warn" : "down"}>
                {checkRes.ok ? "valid" : checkRes.reachable ? `reachable (${checkRes.status})` : "invalid"}
              </Badge>
              {checkRes.error && <span className="text-text-subtle">{checkRes.error}</span>}
            </div>
          )}
          <Field label="Model ID" hint="optional — seed one if the provider has no /models endpoint">
            <Input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder={preset.modelHint} className="font-mono text-[12.5px]" />
          </Field>
        </div>

        {err && <div className="mt-2 text-[12px] text-danger">{err}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add provider"}</Button>
        </div>
      </form>
    </div>
  );
}
