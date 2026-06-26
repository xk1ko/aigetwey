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

  const baseUrl = `http://127.0.0.1:${ep.port}`;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-text">Endpoint</h1>
        <p className="mt-1 text-[13px] text-text-muted">Gateway address and token-saver toggles.</p>
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
