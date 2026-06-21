"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Empty } from "@/components/ui";
import { stringify } from "yaml";

/**
 * Raw config editor. Loads the masked config as YAML, lets the operator edit it,
 * and PUTs the text back — the gateway re-validates (zod) and hot-reloads, so an
 * invalid edit is rejected with the validation message and the old config keeps
 * serving. Masked keys (sk-…1234) left unchanged are restored server-side.
 */
export function ConfigEditor() {
  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");
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
    const cfg = await res.json();
    const yaml = stringify(cfg);
    setText(yaml);
    setOriginal(yaml);
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

  const dirty = text !== original;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-text">Config</h1>
          <p className="mt-1 text-[13px] text-text-muted">
            Raw YAML. Saving validates and hot-reloads — invalid edits are rejected, the live config keeps serving.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-[12px] text-warning">unsaved changes</span>}
          {saved && (
            <span className="flex items-center gap-1 text-[12px] text-success">
              <Icon name="check" size={14} /> saved
            </span>
          )}
          <Button variant="ghost" disabled={!dirty || busy} onClick={() => setText(original)}>Revert</Button>
          <Button disabled={!dirty || busy} onClick={save}>{busy ? "Saving…" : "Save & reload"}</Button>
        </div>
      </div>

      {error && (
        <pre className="mb-3 overflow-x-auto rounded-brand border border-danger/40 bg-danger/8 px-3 py-2 text-[12px] text-danger whitespace-pre-wrap">
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
          className="h-[60vh] w-full resize-none rounded-brand-lg border border-border bg-bg p-4 font-mono text-[12.5px] leading-relaxed text-text focus:border-accent focus:outline-none"
        />
      )}
    </div>
  );
}
