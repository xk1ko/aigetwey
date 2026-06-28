"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
import { Badge, FormatBadge } from "@/components/Badge";
import { CooldownTimer } from "@/components/CooldownTimer";
import { Button, Input, Field } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Empty } from "@/components/ui";
import { ConfirmModal } from "@/components/ConfirmModal";
import type { MaskedConfig, PingResult, ProviderSnapshot, WireFormat, ImportResult, BatchTestResponse, BatchTestResult } from "@/lib/gateway";

interface Loaded {
  config: MaskedConfig;
  health: ProviderSnapshot[];
}

// format → accent color
const FORMAT_ACCENT: Record<string, { color: string; glow: string; bg: string; border: string }> = {
  openai: { color: "#5dd87f", glow: "rgba(93,216,127,0.4)", bg: "linear-gradient(90deg, rgba(93,216,127,0.4), rgba(93,216,127,0.1))", border: "#5dd87f" },
  anthropic: { color: "#e8a55a", glow: "rgba(232,165,90,0.4)", bg: "linear-gradient(90deg, rgba(232,165,90,0.4), rgba(232,165,90,0.1))", border: "#e8a55a" },
};

export function ProviderManager() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [providerOrder, setProviderOrder] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const [batchTesting, setBatchTesting] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchTestResponse | null>(null);

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

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteProvider(id: string) {
    setBusy(true);
    const r = await adminApi.removeProvider(id);
    setBusy(false);
    if (r.ok) {
      setConfirmDelete(null);
      void reload();
    } else {
      setDeleteError(r.error ?? "failed to delete provider");
    }
  }

  async function deleteSelected() {
    setBusy(true);
    for (const id of selected) {
      await adminApi.removeProvider(id);
    }
    setBusy(false);
    setConfirmBulk(false);
    setSelected(new Set());
    setSelectMode(false);
    void reload();
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const providers = Array.isArray(parsed?.providers) ? parsed.providers : Array.isArray(parsed) ? parsed : [];
      if (providers.length === 0) {
        setImportResult({ added: [], merged: [], skipped: [{ id: "?", reason: "no providers found in file" }] });
        setBusy(false);
        return;
      }
      const r = await adminApi.importProviders(providers);
      if (r.ok && r.data) {
        setImportResult(r.data.result);
        void reload();
      } else {
        setImportResult({ added: [], merged: [], skipped: [{ id: "?", reason: r.error ?? "import failed" }] });
      }
    } catch {
      setImportResult({ added: [], merged: [], skipped: [{ id: "?", reason: "invalid JSON file" }] });
    }
    setBusy(false);
  }

  async function testAll() {
    setBatchTesting(true);
    setBatchResult(null);
    const r = await adminApi.testAllProviders();
    if (r.ok && r.data) setBatchResult(r.data);
    setBatchTesting(false);
  }

  if (error) return <Empty>{error}</Empty>;
  if (!data) return <Empty>Loading…</Empty>;

  const healthById = new Map(data.health.map((h) => [h.id, h]));
  const providerMap = new Map(data.config.providers.map((p) => [p.id, p]));
  const orderedProviders = providerOrder
    .map((id) => providerMap.get(id))
    .filter(Boolean) as typeof data.config.providers;

  const activeCount = orderedProviders.filter((p) => {
    const h = healthById.get(p.id);
    const healthy = h ? h.keys.some((k) => k.healthy) : true;
    return !p.disabled && healthy;
  }).length;
  const disabledCount = orderedProviders.length - activeCount;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight heading-gradient heading-accent">Providers</h1>
        </div>
        <div className="flex items-center gap-2">
          <input ref={importInput} type="file" accept=".json,application/json" className="hidden" onChange={handleImport} />
          {orderedProviders.length > 0 && (
            <Button variant="ghost" onClick={() => window.open(adminApi.exportProviders(), "_blank")} title="Download providers as JSON">
              <Icon name="download" size={15} /> Export
            </Button>
          )}
          <Button variant="ghost" disabled={busy || batchTesting} onClick={() => importInput.current?.click()} title="Import providers from JSON (merge)">
            <Icon name="upload" size={15} /> Import
          </Button>
          {orderedProviders.length > 0 && (
            <Button variant="ghost" disabled={batchTesting} onClick={testAll}>
              <Icon name="network_check" size={16} /> {batchTesting ? "Testing…" : "Test All"}
            </Button>
          )}
          {orderedProviders.length > 0 && (
            <>
              {selectMode && (
                <>
                  {selected.size > 0 && (
                    <Button variant="danger" onClick={() => setConfirmBulk(true)} disabled={busy}>
                      <Icon name="delete" size={15} /> Delete {selected.size}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setSelected((s) =>
                        s.size === orderedProviders.length
                          ? new Set()
                          : new Set(orderedProviders.map((p) => p.id)),
                      )
                    }
                  >
                    <Icon name="checklist" size={16} />
                    {selected.size === orderedProviders.length ? "Deselect" : "Select All"}
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setSelectMode((s) => !s);
                  setSelected(new Set());
                }}
              >
                <Icon name={selectMode ? "check" : "checklist"} size={16} />
                {selectMode ? "Done" : "Select"}
              </Button>
            </>
          )}
          <Button onClick={() => setAdding(true)}>
            <Icon name="add" size={17} />
            Add provider
          </Button>
        </div>
      </div>

      {/* stats strip */}
      {orderedProviders.length > 0 && (
        <div className="mb-5 grid grid-cols-3 gap-3">
          <ProviderStat label="Total" value={orderedProviders.length} icon="dns" />
          <ProviderStat label="Active" value={activeCount} icon="check_circle" tone="success" />
          <ProviderStat label="Disabled" value={disabledCount} icon="block" tone={disabledCount > 0 ? "danger" : "neutral"} />
        </div>
      )}

      {batchResult && (
        <div className="mb-5 rounded-brand border border-border/60 bg-surface/50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-3 text-[13px]">
              <span className="font-medium text-text">Test Results</span>
              <span className="text-live">{batchResult.summary.passed} passed</span>
              <span className="text-danger">{batchResult.summary.failed} failed</span>
              <span className="text-dim">{batchResult.summary.total} total</span>
            </div>
            <Button variant="ghost" onClick={() => setBatchResult(null)}>
              <Icon name="close" size={14} />
            </Button>
          </div>
          <div className="space-y-1.5">
            {batchResult.results.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-[12px]">
                <span className={r.ok ? "text-live" : "text-danger"}>
                  {r.ok ? "✓" : "✗"}
                </span>
                <span className="min-w-0 flex-1 truncate text-text">{r.name}</span>
                {r.latencyMs != null && (
                  <span className="text-dim">{r.latencyMs}ms</span>
                )}
                {!r.ok && r.errorType && (
                  <span className="text-danger/70">{r.errorType}</span>
                )}
                {!r.ok && r.error && (
                  <span className="truncate text-danger/50" title={r.error}>{r.error}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

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
                    selectMode={selectMode}
                    isSelected={selected.has(p.id)}
                    onToggleSelect={() => toggleSelect(p.id)}
                    onDelete={() => { setConfirmDelete(p.id); setDeleteError(""); }}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Remove provider"
          message={`Delete "${confirmDelete}"? All keys and model associations will be lost.`}
          error={deleteError}
          busy={busy}
          onCancel={() => { setConfirmDelete(null); setDeleteError(""); }}
          onConfirm={() => deleteProvider(confirmDelete)}
        />
      )}

      {confirmBulk && (
        <ConfirmModal
          title="Remove providers"
          message={`Delete ${selected.size} provider${selected.size > 1 ? "s" : ""}? All keys and model associations will be lost.`}
          busy={busy}
          onCancel={() => setConfirmBulk(false)}
          onConfirm={deleteSelected}
        />
      )}

      {importResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setImportResult(null)}>
          <div className="mx-4 w-full max-w-sm rounded-brand-lg glass-strong modal-card p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-[15px] font-semibold text-text">Import result</h3>
            <div className="space-y-2 text-[13px]">
              {importResult.added.length > 0 && (
                <div className="text-success">+ {importResult.added.length} new: {importResult.added.join(", ")}</div>
              )}
              {importResult.merged.length > 0 && (
                <div className="text-info">↻ {importResult.merged.length} merged: {importResult.merged.map((m) => `${m.id} (+${m.newKeys} keys)`).join(", ")}</div>
              )}
              {importResult.skipped.length > 0 && (
                <div className="text-text-subtle">○ {importResult.skipped.length} skipped: {importResult.skipped.map((s) => `${s.id} (${s.reason})`).join(", ")}</div>
              )}
              {importResult.added.length === 0 && importResult.merged.length === 0 && (
                <div className="text-text-muted">Nothing to import.</div>
              )}
            </div>
            <Button className="mt-4 w-full" onClick={() => setImportResult(null)}>Done</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderStat({ label, value, icon, tone }: { label: string; value: number; icon: string; tone?: "success" | "danger" | "neutral" }) {
  const color = tone === "success" ? "var(--color-success)" : tone === "danger" ? "var(--color-danger)" : "var(--color-accent)";
  return (
    <div className="card rounded-brand-lg px-5 py-3.5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">{label}</div>
        <Icon name={icon} size={16} className="text-text-subtle" />
      </div>
      <div className="mt-0.5 tnum text-[24px] font-bold tracking-tight" style={{ color: value > 0 ? color : "var(--color-text)" }}>{value}</div>
    </div>
  );
}

type ProviderConfig = MaskedConfig["providers"][number];

function SortableProviderCard({
  p,
  healthy,
  cooling,
  onDone,
  selectMode,
  isSelected,
  onToggleSelect,
  onDelete,
}: {
  p: ProviderConfig;
  healthy: boolean;
  cooling: { cooldown_ms: number } | undefined;
  onDone: () => void;
  selectMode: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: p.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    willChange: isDragging ? "transform" : undefined,
  };

  const keyCount = p.free || p.service_account
    ? (p.api_keys?.length ?? 0)
    : (p.api_keys?.length ?? (p.api_key ? 1 : 0));

  const isDown = p.disabled || !healthy;
  const accent = FORMAT_ACCENT[p.format] ?? FORMAT_ACCENT.openai;
  const statusColor = p.disabled ? "var(--color-danger)" : healthy ? "var(--color-success)" : "var(--color-danger)";

  if (selectMode) {
    return (
      <div
        ref={setNodeRef}
        style={{
          ...style,
          ...(isSelected
            ? { borderColor: "var(--color-accent)", boxShadow: "0 0 24px -2px var(--color-accent-glow), inset 0 0 16px -8px var(--color-accent-glow), var(--shadow-card)" }
            : {}),
        }}
        onClick={onToggleSelect}
        className={`group flex cursor-pointer flex-col overflow-hidden rounded-brand-lg card transition-[box-shadow,opacity,border-color] duration-150 ${
          p.disabled ? "opacity-50" : ""
        }`}
      >
        <div className="h-0.5 w-full" style={{ background: accent.bg, opacity: isSelected ? 1 : 0.4 }} />
        <div className="flex items-center justify-between px-5 py-3 pt-3.5">
          <span className="truncate text-[15px] font-bold text-text">{p.name || p.id}</span>
          <FormatBadge format={p.format} />
        </div>
        <div className="flex flex-1 flex-col gap-2 px-5 pb-4">
          <div className="truncate rounded-brand border border-border-subtle bg-bg/50 px-3 py-2 font-mono text-[12px] text-text-muted">
            {p.base_url}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {p.free && keyCount === 0 && <Badge tone="info">free</Badge>}
            <Badge tone="neutral">{keyCount} keys</Badge>
            <Badge tone="neutral">{p.models.length} models</Badge>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex flex-col overflow-hidden rounded-brand-lg card transition-[box-shadow,opacity] duration-150 ${
        isDragging ? "ring-2 ring-accent shadow-elevated z-10 opacity-80" : ""
      } ${p.disabled ? "opacity-50" : ""}`}
    >
      {/* format-colored top strip */}
      <div className="h-0.5 w-full" style={{ background: accent.bg, opacity: 0.6 }} />

      {/* drag handle — pill bar */}
      <div
        {...attributes}
        {...listeners}
        className="absolute inset-x-0 top-1.5 z-10 flex h-5 cursor-grab items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
        onClick={(e) => e.preventDefault()}
      >
        <span className="h-[3px] w-8 rounded-full bg-border-subtle transition-colors group-hover:bg-text-subtle" />
      </div>

      <Link href={`/providers/${encodeURIComponent(p.id)}`} className="flex flex-1 flex-col" draggable={false}>
        {/* header: name + status */}
        <div className="flex items-start justify-between gap-2 px-5 pt-7 pb-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="h-2.5 w-2.5 flex-none rounded-full"
              style={{ background: statusColor, boxShadow: isDown ? `0 0 4px 1px ${statusColor}` : `0 0 6px 1px ${statusColor}` }}
            />
            <div className="min-w-0">
              <div className="truncate text-[15px] font-bold text-text">{p.name || p.id}</div>
              <div className="tnum text-[11px] text-text-subtle">{p.id}/&lt;model&gt;</div>
            </div>
          </div>
          <FormatBadge format={p.format} />
        </div>

        {/* URL in code block */}
        <div className="px-5 pb-3">
          <div className="truncate rounded-brand border border-border-subtle bg-bg/50 px-3 py-2 font-mono text-[12px] text-text-muted">
            {p.base_url}
          </div>
        </div>

        {/* stats row */}
        <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
          {p.free && keyCount === 0 && <Badge tone="info">free</Badge>}
          {p.service_account && <Badge tone="info">service-account</Badge>}
          {(!p.free || keyCount > 0) && (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-muted">
              <Icon name="vpn_key" size={12} className="text-text-subtle" />
              {keyCount} keys
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-muted">
            <Icon name="category" size={12} className="text-text-subtle" />
            {p.models.length} models
          </span>
          {cooling && <CooldownTimer ms={cooling.cooldown_ms} />}
        </div>
      </Link>

      {/* footer: toggle + delete */}
      <div className="flex items-center justify-between border-t border-border-subtle px-5 py-2.5">
        <ProviderToggle id={p.id} disabled={!!p.disabled} onDone={onDone} />
        <button
          type="button"
          onClick={onDelete}
          className="flex h-7 w-7 items-center justify-center rounded-brand text-text-subtle transition-colors hover:bg-danger/10 hover:text-danger"
          aria-label="Remove provider"
          title="Remove provider"
        >
          <Icon name="delete" size={15} />
        </button>
      </div>
    </div>
  );
}

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
      <span
        className={`relative h-5 w-9 rounded-full transition-colors ${disabled ? "bg-danger/30" : "bg-accent"} ${busy ? "opacity-60" : ""}`}
        style={!disabled ? { boxShadow: "0 0 10px -1px var(--color-accent-glow)" } : undefined}
      >
        <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${disabled ? "translate-x-0" : "translate-x-[16px]"}`} />
      </span>

    </button>
  );
}

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
  const [label, setLabel] = useState("");
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

  if (!preset) {
    return (
      <div className="mb-5 card rounded-brand-lg p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-text">Add a provider</h2>
            <p className="mt-0.5 text-[13px] text-text-muted">Pick the API your endpoint speaks — the rest is prefilled.</p>
          </div>
          <button type="button" onClick={onClose} className="flex-none text-text-subtle hover:text-text" aria-label="Cancel">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {PRESETS.map((p) => {
            const accent = FORMAT_ACCENT[p.format];
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => choosePreset(p)}
                className="group flex flex-col gap-1.5 overflow-hidden rounded-brand-lg border border-border bg-bg p-4 text-left transition-all hover:-translate-y-0.5 hover:border-accent/40"
                style={{ borderTopColor: accent?.color, borderTopWidth: 2 }}
              >
                <span className="text-[14px] font-semibold text-text">{p.label}</span>
                <span className="tnum text-[12px] text-text-subtle">{p.sub}</span>
                <span className="text-[12px] text-text-muted">{p.hint}</span>
              </button>
            );
          })}
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
      setErr(!id ? "ID / Prefix is required" : "base URL is required");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await adminApi.addProvider({ id, format: preset.format, base_url: baseUrl, api_key: apiKey || undefined, free: !apiKey.trim(), name: label.trim() || undefined });
    if (!res.ok) {
      setBusy(false);
      setErr(res.error ?? "failed");
      return;
    }
    if (modelId.trim()) await adminApi.addModel(id, modelId.trim());
    setBusy(false);
    onDone();
  }

  return (
    <div className="mb-5 card rounded-brand-lg p-5">
      <form onSubmit={submit}>
        <div className="mb-4 flex items-center gap-2.5 border-b border-border-subtle pb-4">
          <div>
            <div className="text-[14px] font-semibold text-text">{preset.label}</div>
            <div className="tnum text-[11px] text-text-subtle">{preset.sub}</div>
          </div>
          <button
            type="button"
            onClick={() => { setPreset(null); setCheckRes(null); }}
            className="ml-auto inline-flex items-center gap-1 rounded-brand border border-border bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-muted transition-colors hover:border-text-subtle hover:bg-surface-3 hover:text-text"
          >
            <Icon name="arrow_back" size={14} /> change type
          </button>
        </div>

        <div className="space-y-3">
          <Field label="Label" hint="display name in dashboard (optional)">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. My OpenAI" />
          </Field>
          <Field label="ID / Prefix" hint="required — used as prefix when calling models (e.g. prefix/model-name)">
            <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. openai, anthropic" className="font-mono text-[13px]" />
          </Field>
          <Field label="Base URL" hint={preset.hint}>
            <Input value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setCheckRes(null); }} placeholder={preset.base_url} className="font-mono text-[13px]" />
          </Field>
          <Field label="API Key" hint="used for Check and live requests — leave blank for a free / no-auth endpoint">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setCheckRes(null); }}
                  placeholder="sk-…"
                  className="pr-9 font-mono text-[13px]"
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
            <Input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder={preset.modelHint} className="font-mono text-[13px]" />
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
