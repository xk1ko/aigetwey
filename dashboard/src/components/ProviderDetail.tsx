"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { adminApi } from "@/lib/client";
import { Lamp } from "@/components/Lamp";
import { Badge } from "@/components/Badge";
import { CooldownTimer } from "@/components/CooldownTimer";
import { RichCard, CardTitle } from "@/components/RichCard";
import { Button, Input, Field } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { fmt, Empty } from "@/components/ui";
import { ModelSelectModal, type DiscoveredModel } from "@/components/ModelSelectModal";
import { CapacityBadges } from "@/components/CapacityBadges";
import { ConfirmModal } from "@/components/ConfirmModal";
import type { MaskedConfig, MaskedProvider, ProviderSnapshot, PingResult } from "@/lib/gateway";

export function ProviderDetail({ id }: { id: string }) {
  const router = useRouter();
  const [provider, setProvider] = useState<MaskedProvider | null>(null);
  const [health, setHealth] = useState<ProviderSnapshot | null>(null);
  const [error, setError] = useState("");
  const [actionErr, setActionErr] = useState("");
  const [ping, setPing] = useState<PingResult | null>(null);
  const [busy, setBusy] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyCheck, setNewKeyCheck] = useState<PingResult | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editVal, setEditVal] = useState("");
  const [newModel, setNewModel] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [discovered, setDiscovered] = useState<DiscoveredModel[] | null>(null);
  const [modelTest, setModelTest] = useState<Record<string, "testing" | "ok" | "fail">>({});
  const [keyTest, setKeyTest] = useState<Record<number, "testing" | PingResult>>({});
  const [testingAll, setTestingAll] = useState(false);
  const [testAllSummary, setTestAllSummary] = useState<{ total: number; passed: number; failed: number } | null>(null);
  const stopTestAll = useRef(false);
  const [editingConn, setEditingConn] = useState(false);
  const [connUrl, setConnUrl] = useState("");
  const [connPrefix, setConnPrefix] = useState("");
  const [connLabel, setConnLabel] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Record<number, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function testModel(mid: string) {
    setModelTest((t) => ({ ...t, [mid]: "testing" }));
    const r = await adminApi.testModel(id, mid);
    setModelTest((t) => ({ ...t, [mid]: r.ok && r.data?.ok ? "ok" : "fail" }));
  }

  async function testKey(i: number) {
    setKeyTest((t) => ({ ...t, [i]: "testing" }));
    const r = await adminApi.testKey(id, i);
    setKeyTest((t) => ({ ...t, [i]: r.data ?? { ok: false, reachable: false, status: 0, error: r.error } }));
  }

  async function testAllKeys(count: number) {
    stopTestAll.current = false;
    setTestingAll(true);
    setTestAllSummary(null);
    setKeyTest({});
    let passed = 0;
    let failed = 0;
    for (let i = 0; i < count; i++) {
      if (stopTestAll.current) break;
      setKeyTest((t) => ({ ...t, [i]: "testing" }));
      const r = await adminApi.testKey(id, i);
      const result = r.data ?? { ok: false, reachable: false, status: 0, error: r.error };
      setKeyTest((t) => ({ ...t, [i]: result }));
      if (result.ok) passed++;
      else failed++;
      if (i < count - 1 && !stopTestAll.current) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    setTestingAll(false);
    setTestAllSummary({ total: count, passed, failed });
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
    setActionErr("");
    const res = await fn();
    setBusy("");
    if (!res.ok) setActionErr(res.error ?? "action failed");
    else {
      setActionErr("");
      await reload();
    }
  }

  return (
    <div>
      <button onClick={() => router.push("/providers")} className="mb-4 inline-flex items-center gap-1 rounded-brand border border-border bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-muted transition-colors hover:border-text-subtle hover:bg-surface-3 hover:text-text">
        <Icon name="arrow_back" size={14} /> Providers
      </button>

      {/* ─── Header with connection info ─── */}
      <div className="mb-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Lamp state={provider.disabled ? "idle" : (health?.keys.some((k) => k.healthy) ?? true) ? "live" : "down"} />
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight text-text">{provider.name || provider.id}</h1>
              <div className="flex items-center gap-2 text-[12px] text-text-subtle">
                <span className="font-mono">{provider.id}/</span>
                <span>—</span>
                <span className="font-mono">{provider.base_url}</span>
              </div>
            </div>
            {provider.disabled && <Badge tone="down">disabled</Badge>}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => { setEditingConn(true); setConnUrl(provider.base_url); setConnPrefix(provider.id); setConnLabel(provider.name ?? ""); }}>
              <Icon name="edit" size={15} /> Edit
            </Button>
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
        </div>

        {ping && (
          <div className={`mt-2 rounded-brand border px-3 py-2 text-[12px] ${ping.ok ? "border-live/30 bg-live/5 text-live" : "border-danger/30 bg-danger/5 text-danger"}`}>
            {ping.ok
              ? `connected (${ping.status})`
              : ping.error || (ping.reachable ? `server returned ${ping.status}` : "could not reach the endpoint")}
          </div>
        )}
        {actionErr && (
          <div className="mt-2 rounded-brand border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger">
            {actionErr}
          </div>
        )}

        {editingConn && (
          <div className="mt-4 space-y-3 rounded-brand border border-border bg-surface p-4">
            <Field label="Label" hint="display name in dashboard (optional, does not affect routing)">
              <Input value={connLabel} onChange={(e) => setConnLabel(e.target.value)} placeholder={connPrefix || "e.g. My Provider"} className="text-[13px]" />
            </Field>
            <Field label="ID / Prefix" hint="the call prefix (id/model) — changing this breaks CLI tools">
              <Input value={connPrefix} onChange={(e) => setConnPrefix(e.target.value)} placeholder="e.g. openai" className="font-mono text-[13px]" />
            </Field>
            {connPrefix.trim() && connPrefix.trim() !== id && (
              <p className="flex items-start gap-1.5 rounded-brand border border-warning/40 bg-warning/8 px-2.5 py-2 text-[12px] text-warning">
                <Icon name="warning" size={14} className="mt-0.5 flex-none" />
                <span>
                  Renaming rewrites the call string. CLI tools pointing at{" "}
                  <code className="tnum">{id}/…</code> will break until repointed; combos that target it are
                  updated automatically.
                </span>
              </p>
            )}
            <Field label="Base URL">
              <Input value={connUrl} onChange={(e) => setConnUrl(e.target.value)} placeholder="https://..." className="font-mono text-[13px]" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditingConn(false)}>Cancel</Button>
              <Button disabled={busy === "editconn" || !connPrefix.trim()} onClick={() => run("editconn", async () => {
                const newId = connPrefix.trim();
                let activeId = id;
                if (newId && newId !== id) {
                  const rr = await adminApi.renameProvider(id, newId);
                  if (!rr.ok) return rr;
                  activeId = newId;
                }
                const newName = connLabel.trim();
                const r = await adminApi.editProvider(activeId, { base_url: connUrl.trim() || undefined, name: newName });
                if (r.ok) {
                  setEditingConn(false);
                  if (activeId !== id) { router.push(`/providers/${encodeURIComponent(activeId)}`); return r; }
                }
                return r;
              })}>Save</Button>
            </div>
          </div>
        )}
      </div>

      <div className={`space-y-4 transition-opacity ${provider.disabled ? "opacity-50" : ""}`}>
        {/* ─── Keys ─── */}
        <RichCard
          header={
            <>
              <CardTitle title="Keys" sub={`${keys.length} configured`} />
              <div className="flex items-center gap-3">
                {keys.length > 1 && (
                  <Button variant="ghost" disabled={testingAll} onClick={() => testAllKeys(keys.length)}>
                    <Icon name={testingAll ? "progress_activity" : "sync"} size={15} />
                    {testingAll ? "Testing…" : "Test All"}
                  </Button>
                )}
                {testingAll && (
                  <Button variant="ghost" onClick={() => { stopTestAll.current = true; }}>
                    <Icon name="stop" size={15} /> Stop
                  </Button>
                )}
                {provider.strategy === "round-robin" && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-text-subtle" title="Requests per key before rotating to the next one">Sticky:</span>
                    <div className="flex items-center rounded-brand border border-border-subtle">
                      <button
                        type="button"
                        disabled={(provider.sticky ?? 1) <= 1}
                        onClick={() => void adminApi.setProviderStrategy(id, "round-robin", Math.max(1, (provider.sticky ?? 1) - 1)).then(() => reload())}
                        className="px-1.5 py-0.5 text-text-subtle transition-colors hover:text-text disabled:opacity-30"
                        aria-label="Decrease sticky"
                      >
                        <Icon name="remove" size={13} />
                      </button>
                      <span className="tnum w-6 text-center text-[11px] text-text">{provider.sticky ?? 1}</span>
                      <button
                        type="button"
                        onClick={() => void adminApi.setProviderStrategy(id, "round-robin", (provider.sticky ?? 1) + 1).then(() => reload())}
                        className="px-1.5 py-0.5 text-text-subtle transition-colors hover:text-text"
                        aria-label="Increase sticky"
                      >
                        <Icon name="add" size={13} />
                      </button>
                    </div>
                  </div>
                )}
                <span className="text-[11px] text-text-subtle">Round Robin</span>
                <button
                  onClick={() => {
                    const next = provider.strategy === "round-robin" ? null : "round-robin";
                    void adminApi.setProviderStrategy(id, next as "round-robin" | null, provider.sticky ?? 1).then(() => reload());
                  }}
                  className={`relative h-5 w-9 rounded-full transition-colors ${provider.strategy === "round-robin" ? "bg-accent" : "bg-border-subtle"}`}
                  aria-label="Toggle round-robin"
                >
                  <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${provider.strategy === "round-robin" ? "translate-x-[18px]" : "translate-x-0"}`} />
                </button>
              </div>
            </>
          }
        >
          {testAllSummary && (
            <div className="mb-3 flex items-center gap-2 text-[12px]">
              <Badge tone={testAllSummary.failed === 0 ? "live" : "warn"}>
                {testAllSummary.total} tested: {testAllSummary.passed} valid, {testAllSummary.failed} failed
              </Badge>
            </div>
          )}
          {keys.length === 0 ? (
            <Empty>No keys (free / service-account provider).</Empty>
          ) : (
            <div className="max-h-[400px] space-y-1.5 overflow-y-auto">
              {keys.map((k, i) => {
                const ks = health?.keys[i];
                const test = keyTest[i];
                const tested = test && test !== "testing" ? test : null;
                const disabled = provider.disabled_keys?.includes(i) ?? false;
                const lamp = disabled ? "down" : tested ? (tested.ok ? "live" : tested.reachable ? "idle" : "down") : ks ? (ks.healthy ? "live" : "down") : "idle";
                const name = provider.key_names?.[k];
                if (editIdx === i) {
                  return (
                    <div key={i} className="space-y-2 rounded-brand border border-accent bg-accent-soft/40 px-3 py-2.5">
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="key name (optional)" />
                      <Input value={editVal} onChange={(e) => setEditVal(e.target.value)} placeholder="new key value (leave blank to keep)" className="font-mono text-[13px]" />
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => setEditIdx(null)}>Cancel</Button>
                        <Button disabled={busy === `editkey${i}`} onClick={() => run(`editkey${i}`, async () => {
                          const r = await adminApi.editKey(id, i, { name: editName, key: editVal.trim() || undefined });
                          if (r.ok) setEditIdx(null);
                          return r;
                        })}>Save</Button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={i} className={`rounded-brand border border-border-subtle px-3 py-2${disabled ? " opacity-60" : ""}`}>
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col">
                        <button
                          onClick={() => run(`reorder${i}up`, () => adminApi.reorderKey(id, i, i - 1))}
                          disabled={i === 0}
                          className="p-0.5 text-text-subtle hover:text-text disabled:opacity-30"
                          aria-label="Move up"
                        >
                          <Icon name="keyboard_arrow_up" size={14} />
                        </button>
                        <button
                          onClick={() => run(`reorder${i}dn`, () => adminApi.reorderKey(id, i, i + 1))}
                          disabled={i === keys.length - 1}
                          className="p-0.5 text-text-subtle hover:text-text disabled:opacity-30"
                          aria-label="Move down"
                        >
                          <Icon name="keyboard_arrow_down" size={14} />
                        </button>
                      </div>
                      <Lamp state={lamp} />
                      <div className="min-w-0 flex-1">
                        {name && <div className="text-[12px] font-semibold text-text-muted">{name}</div>}
                        <span className="block truncate font-mono text-[13px] text-text">{revealedKeys[i] ?? k}</span>
                      </div>
                      {revealedKeys[i] && (
                        <button
                          onClick={() => { void navigator.clipboard.writeText(revealedKeys[i]!); }}
                          className="flex-none rounded p-1 text-text-subtle transition-colors hover:text-text"
                          aria-label="Copy key"
                          title="Copy to clipboard"
                        >
                          <Icon name="content_copy" size={14} />
                        </button>
                      )}
                      {ks && ks.cooldown_ms > 0 && <CooldownTimer ms={ks.cooldown_ms} />}
                      <button
                        onClick={async () => {
                          if (revealedKeys[i]) { setRevealedKeys((r) => { const n = { ...r }; delete n[i]; return n; }); return; }
                          const r = await adminApi.revealKey(id, i);
                          if (r.ok && r.data?.key) setRevealedKeys((prev) => ({ ...prev, [i]: r.data!.key }));
                        }}
                        className="flex-none rounded p-1 text-text-subtle transition-colors hover:text-text"
                        aria-label={revealedKeys[i] ? "Hide key" : "Show key"}
                        title={revealedKeys[i] ? "Hide key" : "Show key"}
                      >
                        <Icon name={revealedKeys[i] ? "visibility_off" : "visibility"} size={15} />
                      </button>
                      <button
                        onClick={() => run(`toggle${i}`, () => adminApi.toggleKey(id, i, disabled))}
                        className="flex-none rounded p-1 text-text-subtle transition-colors hover:text-text"
                        aria-label={disabled ? "Enable key" : "Disable key"}
                        title={disabled ? "Enable this key" : "Disable this key"}
                      >
                        <Icon name={disabled ? "toggle_off" : "toggle_on"} size={20} className={disabled ? "text-danger" : "text-success"} />
                      </button>
                      <button
                        onClick={() => testKey(i)}
                        disabled={test === "testing"}
                        className="flex-none rounded p-1 text-text-subtle transition-colors hover:text-text disabled:opacity-60"
                        aria-label={`Check key ${i + 1}`}
                        title="Check this key against the base URL"
                      >
                        <Icon name={test === "testing" ? "progress_activity" : "wifi_tethering"} size={15} />
                      </button>
                      <button
                        onClick={() => { setEditIdx(i); setEditName(name ?? ""); setEditVal(""); }}
                        className="flex-none rounded p-1 text-text-subtle transition-colors hover:text-text"
                        aria-label={`Edit key ${i + 1}`}
                        title="Rename or replace this key"
                      >
                        <Icon name="edit" size={15} />
                      </button>
                      <button
                        onClick={() => run(`rmkey${i}`, () => adminApi.removeKey(id, i))}
                        className="flex-none rounded p-1 text-text-subtle transition-colors hover:text-danger"
                        aria-label="Remove key"
                      >
                        <Icon name="delete" size={15} />
                      </button>
                    </div>
                    {tested && (
                      <div className="mt-1.5 pl-8 text-[12px]">
                        <Badge tone={tested.ok ? "live" : tested.reachable ? "warn" : "down"}>
                          {tested.ok ? "valid" : tested.reachable ? `reachable (${tested.status})` : "invalid"}
                        </Badge>
                        {tested.error && <p className="mt-0.5 text-danger">{tested.error}</p>}
                      </div>
                    )}
                    {!tested && ks?.last_error && (
                      <div className="mt-1.5 pl-8 text-[12px]">
                        <p className="text-danger">{ks.last_error.status ? `${ks.last_error.status}: ` : ""}{ks.last_error.message}</p>
                        <span className="text-text-subtle">{new Date(ks.last_error.at).toLocaleTimeString()}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-3 space-y-2">
            <Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="key name (optional, e.g. primary)" />
            <div className="flex gap-2">
              <Input value={newKey} onChange={(e) => { setNewKey(e.target.value); setNewKeyCheck(null); }} placeholder="add a key…" className="font-mono text-[13px]" />
              <Button variant="ghost" disabled={!newKey || busy === "checkkey"} onClick={() => run("checkkey", async () => {
                const r = await adminApi.checkKey(id, newKey);
                setNewKeyCheck(r.data ?? { ok: false, reachable: false, status: 0, error: r.error });
                return r;
              })}>Check</Button>
              <Button disabled={!newKey || busy === "addkey"} onClick={() => run("addkey", async () => {
                const r = await adminApi.addKey(id, newKey, newKeyName.trim() || undefined);
                if (r.ok) { setNewKey(""); setNewKeyName(""); setNewKeyCheck(null); }
                return r;
              })}>Add</Button>
              <Button variant="ghost" onClick={() => setBulkOpen(true)}>Bulk</Button>
            </div>
            {newKeyCheck && (
              <div className={`rounded-brand border px-3 py-2 text-[12px] ${newKeyCheck.ok ? "border-live/30 bg-live/5 text-live" : "border-danger/30 bg-danger/5 text-danger"}`}>
                {newKeyCheck.ok ? `valid (${newKeyCheck.status})` : newKeyCheck.error || `server returned ${newKeyCheck.status}`}
              </div>
            )}
          </div>

          {bulkOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setBulkOpen(false)}>
              <div className="w-full max-w-lg rounded-brand border border-border bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                <h3 className="mb-1 text-[14px] font-semibold text-text">Bulk Add Keys</h3>
                <p className="mb-3 text-[12px] text-text-subtle">Format: <code className="text-text-muted">name|apiKey</code> or just <code className="text-text-muted">apiKey</code> (one per line)</p>
                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={"primary|sk-abc123\nbackup|sk-xyz789\nsk-anonymous-key"}
                  rows={8}
                  className="w-full rounded-brand border border-border bg-bg px-3 py-2 font-mono text-[13px] text-text placeholder:text-text-subtle focus:border-accent focus:outline-none"
                  autoFocus
                />
                <div className="mt-3 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setBulkOpen(false)}>Cancel</Button>
                  <Button disabled={!bulkText.trim() || busy === "bulkkeys"} onClick={() => run("bulkkeys", async () => {
                    const lines = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
                    for (const line of lines) {
                      const pipeIdx = line.indexOf("|");
                      const name = pipeIdx > 0 ? line.slice(0, pipeIdx).trim() : undefined;
                      const key = pipeIdx > 0 ? line.slice(pipeIdx + 1).trim() : line;
                      if (!key) continue;
                      const r = await adminApi.addKey(id, key, name);
                      if (!r.ok) return r;
                    }
                    setBulkText("");
                    setBulkOpen(false);
                    return { ok: true };
                  })}>{busy === "bulkkeys" ? "Adding…" : `Add ${bulkText.split("\n").filter((l) => l.trim()).length} keys`}</Button>
                </div>
              </div>
            </div>
          )}
        </RichCard>

        {/* ─── Models served ─── */}
        <RichCard
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
                <Empty>No model matches &ldquo;{modelFilter}&rdquo;.</Empty>
              ) : (
                <div className="max-h-[280px] divide-y divide-border-subtle overflow-y-auto rounded-brand border border-border-subtle">
                  {shownModels.map((m) => {
                    const st = modelTest[m.id];
                    const statusIcon = st === "ok" ? "check_circle" : st === "fail" ? "cancel" : "smart_toy";
                    const statusColor = st === "ok" ? "text-success" : st === "fail" ? "text-danger" : "text-text-subtle";
                    return (
                      <div key={m.id} className="group flex items-center justify-between gap-3 px-3 py-2 hover:bg-bg">
                        <div className="flex min-w-0 items-center gap-2">
                          <Icon name={statusIcon} size={15} className={`flex-none ${statusColor}`} />
                          <span className="tnum truncate text-[13px]">
                            <span className="text-text-subtle">{provider.id}/</span>
                            <span className="text-text">{m.id}</span>
                          </span>
                          <CapacityBadges model={m.id} provider={provider.id} />
                          {(m.price_in !== undefined || m.price_out !== undefined) && (
                            <span className="tnum whitespace-nowrap text-[11px] text-text-subtle">
                              {fmt.cost(m.price_in ?? 0)}/{fmt.cost(m.price_out ?? 0)} per 1M
                            </span>
                          )}
                        </div>
                        <div className="flex flex-none items-center gap-0.5">
                          <button
                            onClick={() => { navigator.clipboard.writeText(`${provider.id}/${m.id}`); }}
                            className="rounded p-1 text-text-subtle transition-colors hover:bg-surface hover:text-accent"
                            aria-label={`Copy ${provider.id}/${m.id}`}
                            title="Copy model name"
                          >
                            <Icon name="content_copy" size={15} />
                          </button>
                          <button
                            onClick={() => testModel(m.id)}
                            disabled={st === "testing"}
                            className="rounded p-1 text-text-subtle transition-colors hover:bg-surface hover:text-accent disabled:opacity-60"
                            aria-label={`Test ${m.id}`}
                            title={st === "fail" ? "Test failed — click to retry" : "Test this model"}
                          >
                            <Icon name={st === "testing" ? "progress_activity" : "wifi_tethering"} size={15} />
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
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          <Icon name="delete" size={16} /> Remove provider
        </Button>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="Remove provider"
          message={`Delete "${provider.name ?? id}"? All keys and model associations will be lost.`}
          confirmLabel="Remove"
          busy={busy === "rmprov"}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => run("rmprov", async () => {
            const r = await adminApi.removeProvider(id);
            if (r.ok) router.push("/providers");
            else setConfirmDelete(false);
            return r;
          })}
        />
      )}
    </div>
  );
}
