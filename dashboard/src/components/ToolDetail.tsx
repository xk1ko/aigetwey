"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RichCard, CardTitle } from "@/components/RichCard";
import { Badge } from "@/components/Badge";
import { Button, Select } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Empty } from "@/components/ui";
import { adminApi, cliConfig, type CliStatus } from "@/lib/client";
import { toolById } from "@/lib/cliTools";
import type { EndpointPayload, MaskedConfig } from "@/lib/gateway";

/** Step-by-step setup for one CLI tool, with copy-ready env (real key inlined). */
export function ToolDetail({ id }: { id: string }) {
  const router = useRouter();
  const tool = toolById(id);
  const [ep, setEp] = useState<EndpointPayload | null>(null);
  const [combos, setCombos] = useState<string[]>([]);
  const [keyIdx, setKeyIdx] = useState(0);
  const [realKey, setRealKey] = useState("");
  const [error, setError] = useState("");
  const [cli, setCli] = useState<CliStatus | null>(null);
  const [cliBusy, setCliBusy] = useState<"" | "apply" | "reset">("");
  const [cliMsg, setCliMsg] = useState("");

  const loadCli = useCallback(async () => {
    if (!tool?.autoConfig) return;
    const r = await cliConfig.status(tool.id);
    setCli(r.data);
  }, [tool]);
  useEffect(() => { void loadCli(); }, [loadCli]);

  async function applyCli() {
    if (!tool || !ep) return;
    setCliBusy("apply");
    setCliMsg("");
    const baseUrl = `http://127.0.0.1:${ep.port}`;
    // claude maps slots to opus/sonnet/haiku defaults (only those whose combo
    // exists); opencode takes a flat list of model names (your combos).
    let models: string[] | Record<string, string>;
    if (tool.id === "claude-code") {
      const slotKeys = ["opus", "sonnet", "haiku"];
      const m: Record<string, string> = {};
      tool.slots.forEach((s, i) => { if (combos.includes(s.alias)) m[slotKeys[i]] = s.alias; });
      models = m;
    } else {
      models = combos.length ? combos : tool.slots.map((s) => s.alias);
    }
    const r = await cliConfig.apply(tool.id, { base: baseUrl, key: realKey || undefined, models });
    setCliBusy("");
    if (r.ok) { setCliMsg("Wrote config ✓"); void loadCli(); }
    else setCliMsg(r.error ?? "failed");
  }

  async function resetCli() {
    if (!tool) return;
    setCliBusy("reset");
    setCliMsg("");
    const r = await cliConfig.reset(tool.id);
    setCliBusy("");
    if (r.ok) { setCliMsg("Removed gateway config ✓"); void loadCli(); }
    else setCliMsg(r.error ?? "failed");
  }

  useEffect(() => {
    void (async () => {
      const [epRes, cfgRes] = await Promise.all([
        fetch("/api/gw/admin/endpoint"),
        fetch("/api/gw/admin/config"),
      ]);
      if (!epRes.ok) {
        setError("could not reach the gateway");
        return;
      }
      setEp((await epRes.json()) as EndpointPayload);
      if (cfgRes.ok) setCombos(((await cfgRes.json()) as MaskedConfig).models.map((m) => m.alias));
    })();
  }, []);

  // reveal the selected gateway key so the env block is copy-ready (the whole
  // point of this page is to paste a working config locally).
  useEffect(() => {
    if (!ep || ep.keys.length === 0) return;
    void adminApi.revealServerKey(keyIdx).then((r) => setRealKey(r.ok ? r.data?.key ?? "" : ""));
  }, [ep, keyIdx]);

  if (!tool) return <Empty>Unknown tool.</Empty>;
  if (error) return <Empty>{error}</Empty>;
  if (!ep) return <Empty>Loading…</Empty>;

  const base = `http://127.0.0.1:${ep.port}`;
  const env = tool.env(base, realKey);
  const block = env.map((e) => `export ${e.name}="${e.value}"`).join("\n");

  return (
    <div>
      <button onClick={() => router.push("/tools")} className="mb-4 inline-flex items-center gap-1 text-[12px] text-text-muted hover:text-text">
        <Icon name="arrow_back" size={15} /> CLI Tools
      </button>

      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-brand bg-surface-2 text-text-muted">
          <Icon name={tool.icon} size={20} />
        </span>
        <h1 className="text-[22px] font-semibold tracking-tight text-text">{tool.name}</h1>
        <Badge tone="info">{tool.format}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {tool.autoConfig && (
          <RichCard
            className="lg:col-span-2"
            header={
              <>
                <CardTitle title="Local setup" sub="detect this tool on your machine and write its config for you" />
                {cli && (
                  <Badge tone={!cli.installed ? "neutral" : cli.configured ? "live" : "warn"}>
                    {!cli.installed ? "not detected" : cli.configured ? "configured" : "detected"}
                  </Badge>
                )}
              </>
            }
          >
            {!cli ? (
              <p className="text-[12.5px] text-text-subtle">Checking your machine…</p>
            ) : !cli.installed ? (
              <p className="text-[12.5px] text-text-muted">
                Not found on this machine. Install it (above) or paste the manual env below — then re-open this page.
              </p>
            ) : (
              <>
                <p className="text-[12.5px] text-text-muted">
                  {cli.configured ? (
                    <>Already pointed at <span className="tnum text-text">{cli.baseUrl}</span>.</>
                  ) : (
                    <>Detected — click Apply to point it at this gateway automatically.</>
                  )}
                </p>
                {cli.path && <p className="mt-1 tnum text-[11px] text-text-subtle">{cli.path}</p>}
                {cli.models && cli.models.length > 0 && (
                  <p className="mt-1 text-[11.5px] text-text-subtle">models: <span className="tnum text-text-muted">{cli.models.join(", ")}</span></p>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <Button onClick={applyCli} disabled={cliBusy === "apply"}>
                    <Icon name={cliBusy === "apply" ? "progress_activity" : "bolt"} size={15} />
                    {cliBusy === "apply" ? "Applying…" : cli.configured ? "Re-apply" : "Apply config"}
                  </Button>
                  {cli.configured && (
                    <Button variant="ghost" onClick={resetCli} disabled={cliBusy === "reset"}>
                      {cliBusy === "reset" ? "Removing…" : "Reset"}
                    </Button>
                  )}
                  {cliMsg && <span className="text-[12px] text-text-subtle">{cliMsg}</span>}
                </div>
              </>
            )}
          </RichCard>
        )}

        {tool.install && (
          <RichCard header={<CardTitle title="Install" />}>
            <CopyBlock text={tool.install} />
          </RichCard>
        )}

        <RichCard
          className={tool.install ? "" : "lg:col-span-2"}
          header={
            <>
              <CardTitle title="Environment" sub="copy into your shell" />
              {ep.keys.length > 1 && (
                <Select value={String(keyIdx)} onChange={(e) => setKeyIdx(Number(e.target.value))} className="max-w-[180px]">
                  {ep.keys.map((k, i) => (
                    <option key={i} value={i}>{k.name || `key ${i + 1}`}</option>
                  ))}
                </Select>
              )}
            </>
          }
        >
          <CopyBlock text={block} />
          {ep.keys.length === 0 ? (
            <p className="mt-3 text-[12px] text-warning">
              No gateway key set — auth is disabled. Add one under Endpoint, then it appears here.
            </p>
          ) : (
            <p className="mt-3 text-[12px] text-text-subtle">
              Using key <span className="text-text-muted">{ep.keys[keyIdx]?.name || `#${keyIdx + 1}`}</span>. The real value is filled in above.
            </p>
          )}
        </RichCard>

        <RichCard
          className="lg:col-span-2"
          header={<CardTitle title="Models to call" sub="name a combo exactly this — the tool will hit it" />}
        >
          <div className="space-y-1.5">
            {tool.slots.map((s) => {
              const exists = combos.includes(s.alias);
              return (
                <div key={s.alias} className="flex items-center gap-3 rounded-brand border border-border-subtle px-3 py-2">
                  <span className="w-32 flex-none text-[12px] text-text-subtle">{s.label}</span>
                  <Icon name="arrow_forward" size={14} className="flex-none text-text-subtle" />
                  <span className="tnum truncate text-[13px] text-text">{s.alias}</span>
                  <span className="ml-auto flex flex-none items-center gap-2">
                    {exists ? (
                      <Badge tone="live">ready</Badge>
                    ) : (
                      <>
                        <Badge tone="warn">missing</Badge>
                        <button
                          type="button"
                          onClick={() => router.push("/combos")}
                          className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
                        >
                          <Icon name="add" size={13} /> create
                        </button>
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          {combos.length > 0 && (
            <p className="mt-2.5 text-[11px] text-text-subtle">
              Your combos: <span className="tnum text-text-muted">{combos.join(", ")}</span>
            </p>
          )}
        </RichCard>

        <RichCard className="lg:col-span-2" header={<CardTitle title="Steps" />}>
          <ol className="space-y-2.5">
            {tool.steps.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-[13px] text-text-muted">
                <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-surface-2 tnum text-[11px] text-text">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </RichCard>
      </div>
    </div>
  );
}

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-brand border border-border-subtle bg-bg px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-text">
        {text}
      </pre>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="absolute right-2 top-2 flex items-center gap-1 rounded-brand border border-border bg-surface px-2 py-1 text-[11px] text-text-muted hover:text-text"
      >
        <Icon name={copied ? "check" : "content_copy"} size={13} /> {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}
