"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { RichCard, CardTitle } from "@/components/RichCard";
import { Icon } from "@/components/Icon";
import { Empty } from "@/components/ui";
import { stringify } from "yaml";
import type { MaskedConfig } from "@/lib/gateway";

/**
 * Settings — an instance summary (read-only) plus the raw config editor. Saving
 * the YAML re-validates (zod) and hot-reloads on the gateway; an invalid edit is
 * rejected with the message and the live config keeps serving. Masked keys
 * (sk-…1234) left unchanged are restored server-side.
 */
export function ConfigEditor() {
  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");
  const [info, setInfo] = useState<MaskedConfig["server"] | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/gw/admin/config");
    if (!res.ok) {
      setError("could not reach the gateway");
      setLoading(false);
      return;
    }
    const cfg = (await res.json()) as MaskedConfig;
    const yaml = stringify(cfg);
    setText(yaml);
    setOriginal(yaml);
    setInfo(cfg.server);
    setError("");
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    const res = await fetch("/api/gw/admin/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await reload();
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "validation failed");
    }
  }

  const fileInput = useRef<HTMLInputElement>(null);

  // Export the UNMASKED backup straight through the proxy. The download attribute
  // forces a save with our filename even though the proxy labels it as JSON.
  function exportConfig() {
    const a = document.createElement("a");
    a.href = "/api/gw/admin/config/export";
    a.download = "aigetwey-config.yaml";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Load a backup file INTO the editor (not a blind apply) so it goes through the
  // same validate + hot-reload path on Save, and the operator reviews it first.
  async function importFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setText(await file.text());
    setError("");
  }

  const dirty = text !== original;
  const keyCount = info?.api_keys.length ?? 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-text">Settings</h1>
        <p className="mt-1 text-[13px] text-text-muted">Instance details and the raw gateway config.</p>
      </div>

      <div className="grid gap-4">
        <RichCard header={<CardTitle title="Instance" sub="read-only" />}>
          {info ? (
            <div className="space-y-2.5 text-[13px]">
              <Row label="Listen address">
                <span className="tnum text-text">{info.host}:{info.port}</span>
              </Row>
              <Row label="Gateway auth">
                <Badge tone={keyCount > 0 ? "live" : "warn"}>
                  {keyCount > 0 ? `${keyCount} key${keyCount > 1 ? "s" : ""}` : "disabled (localhost only)"}
                </Badge>
              </Row>
              <Row label="Admin password">
                <span className="text-text-subtle">set via AIGETWEY_ADMIN_PASSWORD (run.sh)</span>
              </Row>
            </div>
          ) : (
            <Empty>Loading…</Empty>
          )}
        </RichCard>

        <RichCard
          header={
            <>
              <CardTitle title="Raw config" sub="YAML — validated + hot-reloaded on save" />
              <div className="flex items-center gap-2">
                {dirty && <span className="text-[12px] text-warning">unsaved changes</span>}
                {saved && (
                  <span className="flex items-center gap-1 text-[12px] text-success">
                    <Icon name="check" size={14} /> saved
                  </span>
                )}
                <input ref={fileInput} type="file" accept=".yaml,.yml,.json,text/*" className="hidden" onChange={importFile} />
                <Button variant="ghost" disabled={busy} onClick={exportConfig} title="Download the full config (includes real keys)">
                  <Icon name="download" size={14} /> Export
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => fileInput.current?.click()} title="Load a backup file into the editor">
                  <Icon name="upload" size={14} /> Import
                </Button>
                <Button variant="ghost" disabled={!dirty || busy} onClick={() => setText(original)}>Revert</Button>
                <Button disabled={!dirty || busy} onClick={save}>{busy ? "Saving…" : "Save & reload"}</Button>
              </div>
            </>
          }
        >
          {error && (
            <pre className="mb-3 overflow-x-auto whitespace-pre-wrap rounded-brand border border-danger/40 bg-danger/8 px-3 py-2 text-[12px] text-danger">
              {error}
            </pre>
          )}
          {loading ? (
            <Empty>Loading…</Empty>
          ) : (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              className="h-[55vh] w-full resize-none rounded-brand border border-border bg-bg p-4 font-mono text-[12.5px] leading-relaxed text-text focus:border-accent focus:outline-none"
            />
          )}
        </RichCard>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-subtle">{label}</span>
      {children}
    </div>
  );
}
