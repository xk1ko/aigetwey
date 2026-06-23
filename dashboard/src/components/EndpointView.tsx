"use client";

import { useEffect, useState, useCallback } from "react";
import { adminApi } from "@/lib/client";
import { Badge } from "@/components/Badge";
import { RichCard, CardTitle } from "@/components/RichCard";
import { Button, Input } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { KeyReveal } from "@/components/KeyReveal";
import { Empty } from "@/components/ui";
import type { EndpointPayload, InjectLevel } from "@/lib/gateway";

const LEVELS: InjectLevel[] = ["off", "lite", "full", "ultra"];

/** Generate a random gateway key client-side (like 9router's one-click create). */
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
  const [manual, setManual] = useState(false);

  const reload = useCallback(async () => {
    const r = await adminApi.endpoint();
    if (!r.ok) {
      setError(r.error ?? "could not reach the gateway");
      return;
    }
    setError("");
    setEp(r.data);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-text">Endpoint</h1>
        <p className="mt-1 text-[13px] text-text-muted">Gateway address, client keys, and the token-saver toggles.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RichCard header={<CardTitle title="Gateway URL" />}>
          <div className="space-y-2 text-[13px]">
            <CopyRow label="OpenAI base_url" value={`${baseUrl}/v1`} />
            <CopyRow label="Anthropic base_url" value={baseUrl} />
          </div>
        </RichCard>

        <RichCard header={<CardTitle title="Gateway keys" sub={`${ep.keys.length} configured`} />}>
          {ep.keys.length === 0 ? (
            <Empty>No keys — auth is DISABLED (localhost only). Generate one below.</Empty>
          ) : (
            <div className="space-y-1.5">
              {ep.keys.map((k, i) => (
                <div key={i} className="flex items-center justify-between gap-2 rounded-brand border border-border-subtle px-3 py-2">
                  <KeyReveal
                    masked={k}
                    reveal={async () => {
                      const r = await adminApi.revealServerKey(i);
                      return r.ok ? r.data?.key ?? null : null;
                    }}
                  />
                  <button onClick={() => run(`rmkey${i}`, () => adminApi.removeServerKey(i))} className="flex-none text-text-subtle hover:text-danger" aria-label="Remove key">
                    <Icon name="delete" size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 space-y-2">
            {/* one-click generate is the primary path (like 9router) */}
            <Button
              disabled={busy === "genkey"}
              className="w-full"
              onClick={() => run("genkey", () => adminApi.addServerKey(generateKey()))}
            >
              <Icon name="add" size={16} /> {busy === "genkey" ? "Generating…" : "Generate key"}
            </Button>
            <button onClick={() => setManual((v) => !v)} className="text-[12px] text-text-subtle hover:text-text">
              {manual ? "Hide manual entry" : "Or enter a key manually"}
            </button>
            {manual && (
              <div className="flex gap-2">
                <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="paste a key…" />
                <Button variant="ghost" disabled={!newKey || busy === "addkey"} onClick={() => run("addkey", async () => {
                  const r = await adminApi.addServerKey(newKey);
                  if (r.ok) setNewKey("");
                  return r;
                })}>Add</Button>
              </div>
            )}
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
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-bg transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
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
