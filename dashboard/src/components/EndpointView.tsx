"use client";

import { useEffect, useState, useCallback } from "react";
import { adminApi } from "@/lib/client";
import { Badge } from "@/components/Badge";
import { RichCard, CardTitle } from "@/components/RichCard";
import { Button, Input } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { KeyReveal } from "@/components/KeyReveal";
import { Empty } from "@/components/ui";
import { ModelPicker, type ModelGroup } from "@/components/ModelPicker";
import type { EndpointPayload, HeadroomStatusReply, InjectLevel, MaskedConfig } from "@/lib/gateway";

const LEVELS: InjectLevel[] = ["off", "lite", "full", "ultra"];

/** Generate a random gateway key client-side (aigetwey's one-click create). */
function generateKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `aig-${hex}`;
}

export function EndpointView() {
  const [ep, setEp] = useState<EndpointPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [newKey, setNewKey] = useState("");
  const [keyName, setKeyName] = useState("");
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null);
  const [hr, setHr] = useState<HeadroomStatusReply | null>(null);
  const [editKey, setEditKey] = useState<number | null>(null);
  const [editKeyName, setEditKeyName] = useState("");
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [scopeKey, setScopeKey] = useState<number | null>(null);
  const [scopeModels, setScopeModels] = useState<string[]>([]);
  const [scopeRpm, setScopeRpm] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const reload = useCallback(async () => {
    const r = await adminApi.endpoint();
    if (!r.ok) {
      setError(r.error ?? "could not reach the gateway");
      return;
    }
    setError("");
    setEp(r.data);
  }, []);

  // Headroom status is a live probe (installed/running/python), separate from the
  // endpoint config — reload it on mount and after any headroom action.
  const reloadHr = useCallback(async () => {
    const r = await adminApi.headroomStatus();
    if (r.ok) setHr(r.data);
  }, []);

  useEffect(() => {
    void reload();
    void reloadHr();
    // load the model catalog for the per-key scope picker (combos + provider/model refs).
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
      } catch { /* non-critical — picker will just be empty */ }
    })();
  }, [reload, reloadHr]);

  if (error) return <Empty>{error}</Empty>;
  if (!ep) return <Empty>Loading…</Empty>;

  const baseUrl = `http://127.0.0.1:${ep.port}`;

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(label);
    const r = await fn();
    setBusy("");
    if (!r.ok) setError(r.error ?? "action failed");
    else {
      setError("");
      await reload();
    }
  }

  // Create a key (generated or pasted) with its label, then surface it once in a
  // modal — aigetwey, where the full key is shown at creation time.
  async function addKey(label: string, rawKey: string) {
    const name = (label || "Gateway key").trim();
    setBusy("genkey");
    const r = await adminApi.addServerKey(rawKey, name);
    setBusy("");
    if (!r.ok) {
      setError(r.error ?? "could not add key");
      return;
    }
    setError("");
    setKeyName("");
    setNewKey("");
    setCreated({ key: rawKey, name });
    await reload();
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-text">Endpoint &amp; Key</h1>
        <p className="mt-1 text-[13px] text-text-muted">Gateway address, client keys, and the token-saver toggles.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RichCard header={<CardTitle title="Gateway URL" sub="one endpoint for every client" />}>
          <div className="text-[13px]">
            <CopyRow label="Gateway URL" value={baseUrl} />
          </div>
          <p className="mt-3 text-[12px] text-text-subtle">
            One gateway, both formats. Anthropic clients (Claude Code) use it as-is; OpenAI clients (opencode,
            Cursor, Codex) append <span className="tnum">/v1</span>. The <span className="text-text-muted">CLI Tools</span>{" "}
            page has copy-ready env per tool.
          </p>
        </RichCard>

        <RichCard header={<CardTitle title="Gateway keys" sub={`${ep.keys.length} configured`} />}>
          {ep.keys.length === 0 ? (
            <Empty>No keys — auth is DISABLED (localhost only). Generate one below.</Empty>
          ) : (
            <div className="space-y-1.5">
              {ep.keys.map((k, i) =>
                editKey === i ? (
                  <div key={i} className="space-y-2 rounded-brand border border-accent bg-accent-soft/40 px-3 py-2.5">
                    <Input value={editKeyName} onChange={(e) => setEditKeyName(e.target.value)} placeholder="key name (e.g. Claude Code)" />
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => setEditKey(null)}>Cancel</Button>
                      <Button
                        disabled={busy === `editkey${i}`}
                        onClick={() =>
                          run(`editkey${i}`, async () => {
                            const r = await adminApi.editServerKey(i, editKeyName.trim());
                            if (r.ok) setEditKey(null);
                            return r;
                          })
                        }
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div key={i} className="space-y-0 rounded-brand border border-border-subtle">
                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        {k.name && <span className="text-[12px] font-semibold text-text-muted">{k.name}</span>}
                        <KeyReveal
                          masked={k.key}
                          reveal={async () => {
                            const r = await adminApi.revealServerKey(i);
                            return r.ok ? r.data?.key ?? null : null;
                          }}
                        />
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-text-subtle">
                          <span>{k.models?.length ? `${k.models.length} model${k.models.length > 1 ? "s" : ""}` : "all models"}</span>
                          <span>·</span>
                          <span>{k.rpm ? `${k.rpm}/min` : "no rate limit"}</span>
                        </div>
                      </div>
                      <div className="flex flex-none items-center gap-1">
                        <button
                          onClick={() => { setScopeKey(i); setScopeModels(k.models ?? []); setScopeRpm(k.rpm ? String(k.rpm) : ""); }}
                          className="text-text-subtle hover:text-text"
                          aria-label="Edit key scope"
                          title="Model allowlist + rate limit"
                        >
                          <Icon name="tune" size={15} />
                        </button>
                        <button
                          onClick={() => { setEditKey(i); setEditKeyName(k.name ?? ""); }}
                          className="text-text-subtle hover:text-text"
                          aria-label="Rename key"
                          title="Rename key"
                        >
                          <Icon name="edit" size={15} />
                        </button>
                        <button onClick={() => run(`rmkey${i}`, () => adminApi.removeServerKey(i))} className="text-text-subtle hover:text-danger" aria-label="Remove key">
                          <Icon name="delete" size={16} />
                        </button>
                      </div>
                    </div>
                    {scopeKey === i && (
                      <div className="space-y-2 border-t border-border-subtle bg-accent-soft/40 px-3 py-2.5">
                        <div>
                          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-text-subtle">Allowed models</div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {scopeModels.length === 0 ? (
                              <span className="text-[12px] text-text-subtle">All models (unrestricted)</span>
                            ) : (
                              scopeModels.map((m) => (
                                <span key={m} className="inline-flex items-center gap-1 rounded border border-accent bg-accent-soft px-2 py-0.5 text-[12px] text-accent">
                                  <span className="tnum">{m}</span>
                                  <button onClick={() => setScopeModels((s) => s.filter((x) => x !== m))} className="hover:text-danger" aria-label={`Remove ${m}`}>
                                    <Icon name="close" size={12} />
                                  </button>
                                </span>
                              ))
                            )}
                          </div>
                          <Button type="button" variant="ghost" className="mt-1.5" onClick={() => setPickerOpen(true)}>
                            <Icon name="add" size={15} /> Pick models
                          </Button>
                        </div>
                        <div>
                          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-text-subtle">Rate limit</div>
                          <Input
                            inputMode="numeric"
                            value={scopeRpm}
                            onChange={(e) => setScopeRpm(e.target.value.replace(/[^\d]/g, ""))}
                            placeholder="req/min (blank = unlimited)"
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" onClick={() => setScopeKey(null)}>Cancel</Button>
                          <Button
                            disabled={busy === `scope${i}`}
                            onClick={() =>
                              run(`scope${i}`, async () => {
                                const r = await adminApi.setServerKeyScope(i, {
                                  models: scopeModels,
                                  rpm: scopeRpm ? Number(scopeRpm) : null,
                                });
                                if (r.ok) setScopeKey(null);
                                return r;
                              })
                            }
                          >
                            Save
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ),
              )}
            </div>
          )}
          <div className="mt-3 space-y-2">
            <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="key name (e.g. Claude Code)" />
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="type a custom key, or roll the dice →"
                  className="pr-9 font-mono text-[12.5px]"
                />
                <button
                  type="button"
                  onClick={() => setNewKey(generateKey())}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-subtle hover:text-accent"
                  aria-label="Generate a random key"
                  title="Generate a random key"
                >
                  <Icon name="casino" size={16} />
                </button>
              </div>
              <Button disabled={!newKey.trim() || busy === "genkey"} onClick={() => addKey(keyName, newKey.trim())}>
                <Icon name="add" size={16} /> {busy === "genkey" ? "Adding…" : "Add key"}
              </Button>
            </div>
            <p className="text-[11px] text-text-subtle">Name it, then type your own key or click the dice for a random one.</p>
          </div>
        </RichCard>

        <RichCard className="lg:col-span-2" header={<CardTitle title="Token savers" sub="applied to every request before routing" />}>
          <div className="space-y-4">
            <Toggle
              label="RTK"
              desc="Compress bulky tool_result blocks (diffs, grep, listings) in the request."
              on={ep.rtk}
              busy={busy === "rtk"}
              onChange={(v) => run("rtk", () => adminApi.setRtk(v))}
            />
            <LevelRow
              label="Caveman"
              desc="Terser model output — drops filler, keeps substance."
              value={ep.caveman}
              busy={busy === "caveman"}
              onChange={(lvl) => run("caveman", () => adminApi.setCaveman(lvl))}
            />
            <LevelRow
              label="Ponytail"
              desc="Minimal, YAGNI code style — deletion over addition."
              value={ep.ponytail}
              busy={busy === "ponytail"}
              onChange={(lvl) => run("ponytail", () => adminApi.setPonytail(lvl))}
            />
          </div>
        </RichCard>

        <HeadroomCard
          ep={ep}
          hr={hr}
          refresh={async () => {
            await reload();
            await reloadHr();
          }}
        />
      </div>

      {created && <KeyCreatedModal name={created.name} value={created.key} onClose={() => setCreated(null)} />}
      {pickerOpen && (
        <ModelPicker
          title="Allowed models"
          note="Pick the models this key may call. None = all."
          groups={groups}
          selected={scopeModels}
          onToggle={(v) => setScopeModels((s) => s.includes(v) ? s.filter((x) => x !== v) : [...s, v])}
          onClose={() => setPickerOpen(false)}
          showThinkingHint={false}
        />
      )}
    </div>
  );
}

/**
 * Headroom = external context-compression proxy. Status is a live probe; the
 * enable/url/compress fields persist to endpoint config; Start/Stop manage a
 * gateway-spawned proxy when the CLI is installed and the URL is loopback.
 */
function HeadroomCard({
  ep,
  hr,
  refresh,
}: {
  ep: EndpointPayload;
  hr: HeadroomStatusReply | null;
  refresh: () => Promise<void>;
}) {
  const h = ep.headroom;
  const [url, setUrl] = useState(h.url);
  const [localBusy, setLocalBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setUrl(h.url), [h.url]);

  async function act(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setLocalBusy(label);
    setMsg("");
    setCheck(null);
    const r = await fn();
    setLocalBusy("");
    if (!r.ok) setMsg(r.error ?? "action failed");
    await refresh();
  }

  // Live re-probe: ask the gateway whether the proxy at the configured URL
  // actually answers right now, and surface the result inline.
  async function checkProxy() {
    setLocalBusy("check");
    setMsg("");
    setCheck(null);
    const r = await adminApi.headroomStatus();
    setLocalBusy("");
    await refresh();
    if (!r.ok || !r.data) {
      setCheck({ ok: false, text: r.error ?? "could not reach the gateway" });
      return;
    }
    setCheck(
      r.data.running
        ? { ok: true, text: `proxy is up at ${r.data.url}` }
        : { ok: false, text: `no proxy responding at ${r.data.url}` },
    );
  }

  return (
    <RichCard className="lg:col-span-2" header={<CardTitle title="Headroom" sub="external context-compression proxy" />}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <Badge tone={hr?.installed ? "live" : "neutral"}>{hr?.installed ? "installed" : "not installed"}</Badge>
          <Badge tone={hr?.running ? "live" : "warn"}>{hr?.running ? "proxy running" : "proxy down"}</Badge>
          <Badge tone={hr?.python ? "info" : "neutral"}>{hr?.python ? `python ${hr.python}` : "no python ≥3.10"}</Badge>
          {hr?.managedPid ? <span className="tnum text-text-subtle">pid {hr.managedPid}</span> : null}
        </div>

        <Toggle
          label="Enable headroom"
          desc="Compress the full context through the proxy before each request (fail-open if it's down)."
          on={h.enabled}
          busy={localBusy === "enable"}
          onChange={(v) => act("enable", () => adminApi.setHeadroom({ enabled: v }))}
        />
        <Toggle
          label="Compress user messages"
          desc="Also squeeze user turns, not just tool/assistant context."
          on={h.compress_user_messages}
          busy={localBusy === "cum"}
          onChange={(v) => act("cum", () => adminApi.setHeadroom({ compress_user_messages: v }))}
        />

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-text-subtle">Proxy URL</div>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:8787" className="font-mono text-[12.5px]" />
          </div>
          <Button
            variant="ghost"
            disabled={url.trim() === h.url || localBusy === "url"}
            onClick={() => act("url", () => adminApi.setHeadroom({ url: url.trim() }))}
          >
            Save URL
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={!hr?.canStart || hr?.running || localBusy === "start"}
            onClick={() => act("start", () => adminApi.headroomStart())}
          >
            <Icon name="play_arrow" size={16} /> {localBusy === "start" ? "Starting…" : "Start proxy"}
          </Button>
          <Button
            variant="danger"
            disabled={!hr?.managedPid || localBusy === "stop"}
            onClick={() => act("stop", () => adminApi.headroomStop())}
          >
            <Icon name="stop" size={16} /> Stop
          </Button>
          <Button variant="ghost" disabled={localBusy === "check"} onClick={checkProxy}>
            <Icon name="sync" size={16} /> {localBusy === "check" ? "Checking…" : "Check"}
          </Button>
          {hr && !hr.installed && (
            <span className="text-[11px] text-text-subtle">
              Headroom isn’t installed. Get it from{" "}
              <a href="https://github.com/chopratejas/headroom" target="_blank" rel="noreferrer" className="text-accent hover:underline">
                chopratejas/headroom
              </a>{" "}
              (needs Python ≥ 3.10):{" "}
              <code className="rounded bg-surface-2 px-1">pipx install git+https://github.com/chopratejas/headroom</code>{" "}
              — then re-open this page.
            </span>
          )}
          {hr?.installed && !hr.localUrl && (
            <span className="text-[11px] text-text-subtle">URL isn’t loopback — start that proxy yourself.</span>
          )}
        </div>

        {msg && <p className="text-[12px] text-danger">{msg}</p>}
        {check && (
          <p className={`flex items-center gap-1 text-[12px] ${check.ok ? "text-success" : "text-danger"}`}>
            <Icon name={check.ok ? "check_circle" : "error"} size={14} /> {check.text}
          </p>
        )}
      </div>
    </RichCard>
  );
}

/** Shows a freshly created key once (it's masked everywhere after), with copy. */
function KeyCreatedModal({ name, value, onClose }: { name: string; value: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-brand-lg border border-border bg-surface p-5 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-accent">
            <Icon name="key" size={16} />
          </span>
          <h2 className="text-[15px] font-semibold text-text">Key created</h2>
        </div>
        <p className="mb-3 text-[12px] text-text-muted">
          Copy <span className="text-text">{name}</span> now. You can reveal it again later from this page.
        </p>
        <button
          onClick={() => {
            void navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex w-full items-center justify-between gap-2 rounded-brand border border-border-subtle bg-bg px-3 py-2.5 text-left hover:border-text-subtle"
        >
          <span className="tnum truncate text-[12.5px] text-text">{value}</span>
          <Icon name={copied ? "check" : "content_copy"} size={15} />
        </button>
        <div className="mt-4 flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-subtle">{label}</span>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="flex items-center gap-1.5 rounded-brand border border-border-subtle px-2.5 py-1 tnum text-[12.5px] text-text hover:border-text-subtle"
      >
        {value}
        <Icon name={copied ? "check" : "content_copy"} size={13} />
      </button>
    </div>
  );
}

function Toggle({ label, desc, on, busy, onChange }: { label: string; desc: string; on: boolean; busy: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-[13px] font-semibold text-text">{label}</div>
        <div className="text-[12px] text-text-muted">{desc}</div>
      </div>
      <button
        disabled={busy}
        onClick={() => onChange(!on)}
        className={`relative h-6 w-11 flex-none rounded-full transition-colors ${on ? "bg-accent" : "bg-surface-3"}`}
        aria-pressed={on}
      >
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-bg transition-transform ${on ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

function LevelRow({ label, desc, value, busy, onChange }: { label: string; desc: string; value: InjectLevel; busy: boolean; onChange: (l: InjectLevel) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-text">{label}</span>
          {value !== "off" && <Badge tone="info">{value}</Badge>}
        </div>
        <div className="text-[12px] text-text-muted">{desc}</div>
      </div>
      <div className="flex flex-none items-center gap-1 rounded-full border border-border bg-surface p-1">
        {LEVELS.map((lvl) => (
          <button
            key={lvl}
            disabled={busy}
            onClick={() => onChange(lvl)}
            className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
              value === lvl ? "bg-surface-2 text-text" : "text-text-muted hover:text-text"
            }`}
          >
            {lvl}
          </button>
        ))}
      </div>
    </div>
  );
}
