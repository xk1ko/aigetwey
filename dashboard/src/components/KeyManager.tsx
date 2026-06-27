"use client";

import { useEffect, useState, useCallback } from "react";
import { adminApi } from "@/lib/client";
import { Button, Input } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Badge } from "@/components/Badge";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Empty, fmt } from "@/components/ui";
import { KeyScopeModal } from "@/components/KeyScopeModal";
import type { EndpointPayload, MaskedConfig } from "@/lib/gateway";
import type { ModelGroup } from "@/components/ModelPicker";

type ServerKey = EndpointPayload["keys"][number];

function generateKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `aig-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function KeyManager() {
  const [ep, setEp] = useState<EndpointPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [keyName, setKeyName] = useState("");
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null);
  const [pendingDel, setPendingDel] = useState<{ i: number; label: string } | null>(null);
  const [scopeKey, setScopeKey] = useState<number | null>(null);
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [keyBudgets, setKeyBudgets] = useState<Record<string, { limit: number; window: string }>>({});

  const reload = useCallback(async () => {
    const [r, br] = await Promise.all([
      adminApi.endpoint(),
      adminApi.budgets(),
    ]);
    if (!r.ok) { setError(r.error ?? "could not reach gateway"); return; }
    setError("");
    setEp(r.data);
    if (br.ok && br.data) {
      const map: Record<string, { limit: number; window: string }> = {};
      for (const b of br.data.budgets) {
        if (b.scope.type === "key") map[b.scope.id] = { limit: b.limit, window: b.window };
      }
      setKeyBudgets(map);
    }
  }, []);

  useEffect(() => {
    void reload();
    void (async () => {
      try {
        const res = await fetch("/api/gw/admin/config");
        if (!res.ok) return;
        const cfg = (await res.json()) as MaskedConfig;
        const grps: ModelGroup[] = [];
        if (cfg.models.length) grps.push({ label: "Combos", items: cfg.models.map((m) => ({ value: m.alias, label: m.alias })) });
        for (const p of cfg.providers) {
          if (p.models.length) grps.push({ label: p.id, items: p.models.map((m) => ({ value: `${p.id}/${m.id}`, label: `${p.id}/${m.id}` })) });
        }
        setGroups(grps);
      } catch { /* non-critical */ }
    })();
  }, [reload]);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(label);
    const r = await fn();
    setBusy("");
    if (!r.ok) setError(r.error ?? "action failed");
    else { setError(""); await reload(); }
  }

  async function addKey(label: string, rawKey: string) {
    const name = label.trim();
    if (name && ep && ep.keys.some((k) => k.name === name)) {
      setError(`Key name "${name}" already exists`);
      return;
    }
    setBusy("genkey");
    const r = await adminApi.addServerKey(rawKey, name || undefined);
    setBusy("");
    if (!r.ok) { setError(r.error ?? "could not add key"); return; }
    setError("");
    setKeyName("");
    setCreated({ key: rawKey, name });
    await reload();
  }

  if (!ep) return <Empty>Loading…</Empty>;

  const activeKey = scopeKey !== null ? ep.keys[scopeKey] : null;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-text">Access Keys</h1>
          <p className="mt-1 text-[13px] text-text-muted">Client API keys — each can have its own models, rate limit, and budget.</p>
        </div>
        <div className="flex items-center gap-2">
          <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Search or name new key…" className="w-48" />
          <Button disabled={busy === "genkey"} onClick={() => addKey(keyName, generateKey())} className="whitespace-nowrap">
            <Icon name="add" size={16} />{busy === "genkey" ? "Adding…" : "Add key"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-brand border border-danger/30 bg-danger/8 px-4 py-2.5 text-[13px] text-danger">
          <span>{error}</span>
          <button onClick={() => setError("")} className="hover:text-text"><Icon name="close" size={15} /></button>
        </div>
      )}

      {ep.keys.length === 0 ? (
        <Empty>No keys — auth is DISABLED (localhost only). Add one above.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ep.keys.map((k, i) => {
            if (keyName && !(k.name ?? "").toLowerCase().includes(keyName.toLowerCase()) && !k.key.toLowerCase().includes(keyName.toLowerCase())) return null;
            const expired = !!k.expires && Date.now() > k.expires;
            const budget = keyBudgets[k.fingerprint];
            return (
              <div
                key={i}
                className={`group flex flex-col rounded-brand-lg border bg-surface p-4 shadow-soft transition-colors ${
                  expired ? "border-danger/35 opacity-70" : "border-border hover:border-text-subtle"
                }`}
              >
                {/* header row */}
                <div className="flex items-start justify-between gap-2">
                  <KeyRevealInline
                    name={k.name || "Unnamed key"}
                    masked={k.key}
                    reveal={async () => { const r = await adminApi.revealServerKey(i); return r.ok ? r.data?.key ?? null : null; }}
                  />
                  <Badge tone={expired ? "danger" : "live"}>{expired ? "expired" : "active"}</Badge>
                </div>

                {/* info pills */}
                <div className="mt-3 flex flex-col items-start gap-1.5">
                  <span className="inline-flex items-center rounded-brand bg-bg px-2 py-0.5 text-[12px] text-text-muted">
                    {k.models?.length ? `${k.models.length} model${k.models.length > 1 ? "s" : ""}` : "all models"}
                  </span>
                  {k.rpm && (
                    <span className="inline-flex items-center rounded-brand bg-bg px-2 py-0.5 text-[12px] tnum text-text-muted">
                      {k.rpm}/min
                    </span>
                  )}
                  {budget && (
                    <span className="inline-flex items-center rounded-brand bg-accent-soft px-2 py-0.5 text-[12px] tnum text-accent">
                      ${budget.limit} / {budget.window.replace("day", " days").replace("h", "h")}
                    </span>
                  )}
                  {k.expires && !expired && (
                    <span className="inline-flex items-center rounded-brand bg-bg px-2 py-0.5 text-[12px] tnum text-text-subtle">
                      expires {fmt.date(k.expires)}
                    </span>
                  )}
                </div>

                {/* actions */}
                <div className="mt-auto flex items-center gap-2 pt-4">
                  <button onClick={() => { setScopeKey(i); }} className="inline-flex items-center gap-1.5 rounded-brand border border-border px-3 py-1.5 text-[13px] text-text-muted hover:border-text-subtle hover:text-text">
                    <Icon name="edit" size={14} /> Edit
                  </button>
                  <button onClick={() => setPendingDel({ i, label: k.name || k.key })} className="inline-flex items-center gap-1.5 rounded-brand border border-border px-3 py-1.5 text-[13px] text-text-muted hover:border-danger/40 hover:text-danger">
                    <Icon name="delete" size={14} /> Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Scope modal */}
      {scopeKey !== null && activeKey && (
        <KeyScopeModal
          keyIndex={scopeKey}
          k={activeKey}
          fingerprint={activeKey.fingerprint}
          groups={groups}
          keyBudget={keyBudgets[activeKey.fingerprint]}
          onClose={() => setScopeKey(null)}
          onSave={() => { setScopeKey(null); void reload(); }}
        />
      )}

      {/* New key reveal modal */}
      {created && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => setCreated(null)}>
          <div className="w-full max-w-lg rounded-brand-lg border border-border bg-surface p-5 shadow-elevated" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-[14px] font-semibold text-text">Key created — copy it now</h2>
            <p className="mb-3 text-[12px] text-text-muted">Copy your key now. You can reveal it later, but storing it saves time.</p>
            <div className="flex items-center gap-2 rounded-brand bg-bg px-3 py-2">
              <code className="flex-1 truncate text-[12px] text-text">{created.key}</code>
              <button onClick={() => void navigator.clipboard.writeText(created.key)} className="text-text-subtle hover:text-text"><Icon name="content_copy" size={14} /></button>
            </div>
            <Button className="mt-4 w-full" onClick={() => setCreated(null)}>Done</Button>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {pendingDel && (
        <ConfirmModal
          title="Remove key?"
          message={`"${pendingDel.label}" will stop working immediately.`}
          confirmLabel="Remove"
          busy={busy === `delkey${pendingDel.i}`}
          onConfirm={() => run(`delkey${pendingDel.i}`, async () => { const r = await adminApi.removeServerKey(pendingDel.i); if (r.ok) setPendingDel(null); return r; })}
          onCancel={() => setPendingDel(null)}
        />
      )}
    </div>
  );
}

function KeyRevealInline({ name, masked, reveal }: { name: string; masked: string; reveal: () => Promise<string | null> }) {
  const [real, setReal] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function toggle() {
    if (shown) { setShown(false); return; }
    if (real === null) {
      setLoading(true);
      const k = await reveal();
      setLoading(false);
      if (k === null) return;
      setReal(k);
    }
    setShown(true);
  }

  return (
    <div className="min-w-0">
      <span className="flex items-center gap-1.5">
        <span className="truncate text-[14px] font-semibold text-text">{name}</span>
      </span>
      <span className={`flex items-center gap-1.5 text-[12px] text-text-subtle tnum ${shown ? "break-all" : ""}`}>
        <button
          onClick={toggle}
          disabled={loading}
          className="flex flex-none items-center justify-center leading-none text-text-muted transition-colors hover:text-accent disabled:opacity-40"
          aria-label={shown ? "Hide key" : "Show key"}
          title={shown ? "Hide key" : "Show key"}
        >
          <Icon name={loading ? "hourglass_empty" : shown ? "visibility_off" : "visibility"} size={14} />
        </button>
        <span className={shown ? "" : "truncate"}>{shown && real ? real : masked}</span>
        {shown && real && (
          <button
            onClick={() => { void navigator.clipboard.writeText(real); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
            className="flex-none text-text-subtle hover:text-text"
            title="Copy"
          >
            <Icon name={copied ? "check" : "content_copy"} size={13} />
          </button>
        )}
      </span>
    </div>
  );
}
