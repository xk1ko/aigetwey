"use client";

import { useEffect, useState, useCallback } from "react";
import { adminApi } from "@/lib/client";
import { RichCard, CardTitle } from "@/components/RichCard";
import { Button, Input } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Empty } from "@/components/ui";
import type { EndpointPayload, HeadroomStatusReply, InjectLevel } from "@/lib/gateway";

const LEVELS: InjectLevel[] = ["off", "lite", "full", "ultra"];

export function EndpointView() {
  const [ep, setEp] = useState<EndpointPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [hr, setHr] = useState<HeadroomStatusReply | null>(null);

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
  }, [reload, reloadHr]);

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

  if (error) return <Empty>{error}</Empty>;
  if (!ep) return <Empty>Loading…</Empty>;

  const baseUrl = `http://localhost:${ep.port}`;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-text">Endpoint</h1>
        <p className="mt-1 text-[13px] text-text-muted">Gateway address and token-saver toggles.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RichCard className="lg:col-span-2" header={<CardTitle title="Gateway URL" sub="one endpoint for every client" />}>
          <div className="text-[13px] space-y-2.5">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Local
              </span>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(baseUrl);
                }}
                className="flex items-center gap-1.5 rounded-brand border border-border-subtle px-2.5 py-1 tnum text-[12.5px] text-text hover:border-text-subtle"
              >
                {baseUrl}
                <Icon name="content_copy" size={13} />
              </button>
            </div>
            <TunnelRow />
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
          desc="Compress the full context through the proxy before each request."
          on={h.enabled}
          busy={localBusy === "enable"}
          disabled={!hr?.running && !h.enabled}
          onChange={(v) => act("enable", () => adminApi.setHeadroom({ enabled: v }))}
        />
        <Toggle
          label="Compress user messages"
          desc="Also squeeze user turns, not just tool/assistant context."
          on={h.compress_user_messages}
          busy={localBusy === "cum"}
          disabled={!hr?.running && !h.enabled}
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
            disabled={!hr?.canStart || hr?.running || !!localBusy}
            onClick={async () => {
              await act("start", () => adminApi.headroomStart());
              await checkProxy();
            }}
          >
            <Icon name={localBusy === "start" ? "sync" : "play_arrow"} size={16} className={localBusy === "start" ? "animate-spin" : ""} />
            {localBusy === "start" ? "Starting…" : "Start proxy"}
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

function Toggle({ label, desc, on, busy, disabled, onChange }: { label: string; desc: string; on: boolean; busy: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  const off = busy || disabled;
  return (
    <div className={`flex items-center justify-between gap-4 ${off ? "opacity-40" : ""}`}>
      <div>
        <div className="text-[13px] font-semibold text-text">{label}</div>
        <div className="text-[12px] text-text-muted">{desc}</div>
      </div>
      <button
        disabled={off}
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

type Tone = "live" | "down" | "warn" | "info" | "neutral";

const TONES: Record<Tone, string> = {
  live: "bg-success/12 text-success",
  down: "bg-danger/12 text-danger",
  warn: "bg-warning/12 text-warning",
  info: "bg-info/12 text-info",
  neutral: "bg-surface-2 text-text-muted",
};

function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}${className ? ` ${className}` : ""}`}
    >
      {children}
    </span>
  );
}

function TunnelRow() {
  const [status, setStatus] = useState<{ enabled: boolean; url: string | null; hasAuth?: boolean; isDefaultPassword?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("tunnel-warning-dismissed") === "1";
  });

  useEffect(() => {
    void fetch("/api/gw/admin/tunnel").then(async (r) => {
      if (r.ok) setStatus(await r.json());
    });
  }, []);

  async function toggle() {
    setBusy(true);
    setErr("");
    const method = status?.enabled ? "DELETE" : "POST";
    const r = await fetch("/api/gw/admin/tunnel", { method });
    if (r.ok) {
      setStatus(await r.json());
    } else {
      const body = await r.json().catch(() => ({ error: "failed" }));
      setErr(body.error ?? "failed");
    }
    setBusy(false);
  }

  function dismiss() {
    setDismissed(true);
    localStorage.setItem("tunnel-warning-dismissed", "1");
  }

  const isUnsafe = status && !status.enabled && (!status.hasAuth || status.isDefaultPassword);
  const showWarning = isUnsafe && !dismissed;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {status?.enabled ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-[11px] font-medium text-blue-400">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
            Tunnel
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-alt px-2.5 py-0.5 text-[11px] font-medium text-text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-text-muted" />
            Tunnel
          </span>
        )}
        {busy ? (
          <span className="flex items-center gap-2 text-[12px] text-text-muted">
            <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {status?.enabled ? "Disconnecting…" : "Starting tunnel… this may take a few seconds"}
          </span>
        ) : status?.enabled && status.url ? (
          <button
            onClick={() => void navigator.clipboard.writeText(status.url!)}
            className="flex items-center gap-1.5 rounded-brand border border-border-subtle px-2.5 py-1 tnum text-[12.5px] text-text hover:border-text-subtle"
          >
            {status.url}
            <Icon name="content_copy" size={13} />
          </button>
        ) : null}
        {!busy && (
          <Button
            variant={status?.enabled ? "ghost" : "primary"}
            disabled={busy}
            onClick={toggle}
            className="!px-2.5 !py-1 !text-[11.5px]"
          >
            <Icon name={status?.enabled ? "link_off" : "link"} size={12} />
            {status?.enabled ? "Disable" : "Enable"}
          </Button>
        )}
      </div>
      {showWarning && (
        <div className="flex items-start gap-2 rounded-brand border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-400">
          <Icon name="warning" size={14} className="mt-0.5 shrink-0" />
          <div className="flex-1 space-y-0.5">
            {!status?.hasAuth && (
              <p>No API keys — <a href="/keys" className="font-medium text-amber-300 underline underline-offset-2 decoration-amber-300/50 hover:decoration-amber-300">add in Access Keys</a> before enabling tunnel.</p>
            )}
            {status?.isDefaultPassword && (
              <p>Default password — <a href="/config" className="font-medium text-amber-300 underline underline-offset-2 decoration-amber-300/50 hover:decoration-amber-300">change in Settings</a> before enabling tunnel.</p>
            )}
          </div>
          <button onClick={dismiss} className="shrink-0 p-0.5 rounded hover:bg-amber-500/10 text-amber-400/60 hover:text-amber-400">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {err && <p className="mt-1.5 text-[11px] text-danger">{err}</p>}
    </div>
  );
}
