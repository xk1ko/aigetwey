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
  const [allModels, setAllModels] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]); // openai tools: chosen models
  const [active, setActive] = useState(""); // openai tools: default/active model
  const [slots, setSlots] = useState({ opus: "", sonnet: "", haiku: "" }); // claude
  const isAnthropic = tool?.format === "anthropic";

  const loadCli = useCallback(async () => {
    if (!tool?.autoConfig) return;
    const r = await cliConfig.status(tool.id);
    setCli(r.data);
  }, [tool]);
  useEffect(() => { void loadCli(); }, [loadCli]);

  // seed the editable selection from whatever is already in the tool's config.
  useEffect(() => {
    if (!cli?.installed) return;
    if (isAnthropic && cli.modelSlots) {
      setSlots({ opus: cli.modelSlots.opus ?? "", sonnet: cli.modelSlots.sonnet ?? "", haiku: cli.modelSlots.haiku ?? "" });
    } else if (!isAnthropic && cli.models && cli.models.length > 0) {
      setPicked(cli.models);
      setActive(cli.activeModel ?? cli.models[0] ?? "");
    }
  }, [cli, isAnthropic]);

  async function applyCli() {
    if (!tool || !ep) return;
    setCliMsg("");
    const baseUrl = `http://127.0.0.1:${ep.port}`; // gateway root; opencode route appends /v1
    const key = ep.keys.length ? realKey || undefined : undefined;
    if (isAnthropic) {
      const m: Record<string, string> = {};
      if (slots.opus) m.opus = slots.opus;
      if (slots.sonnet) m.sonnet = slots.sonnet;
      if (slots.haiku) m.haiku = slots.haiku;
      setCliBusy("apply");
      const r = await cliConfig.apply(tool.id, { base: baseUrl, key, models: m });
      setCliBusy("");
      setCliMsg(r.ok ? "Wrote config ✓" : r.error ?? "failed");
      if (r.ok) void loadCli();
      return;
    }
    if (picked.length === 0) { setCliMsg("add at least one model"); return; }
    setCliBusy("apply");
    const r = await cliConfig.apply(tool.id, { base: baseUrl, key, models: picked, active });
    setCliBusy("");
    setCliMsg(r.ok ? "Wrote config ✓" : r.error ?? "failed");
    if (r.ok) void loadCli();
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
      if (cfgRes.ok) {
        const cfg = (await cfgRes.json()) as MaskedConfig;
        const aliases = cfg.models.map((m) => m.alias);
        setCombos(aliases);
        // everything callable: combo aliases + every provider/model ref.
        const refs = cfg.providers.flatMap((p) => p.models.map((m) => `${p.id}/${m.id}`));
        setAllModels([...aliases, ...refs]);
      }
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
              <div className="space-y-3">
                <SetupRow label="Endpoint">
                  <span className="tnum text-[12.5px] text-text">{isAnthropic ? base : `${base}/v1`}</span>
                </SetupRow>

                {ep.keys.length > 0 && (
                  <SetupRow label="API Key">
                    <Select value={String(keyIdx)} onChange={(e) => setKeyIdx(Number(e.target.value))} className="max-w-[260px]">
                      {ep.keys.map((k, i) => (
                        <option key={i} value={i}>{k.name || `key ${i + 1}`}</option>
                      ))}
                    </Select>
                  </SetupRow>
                )}

                {isAnthropic ? (
                  <SetupRow label="Models" top>
                    <div className="flex flex-col gap-2">
                      {(["opus", "sonnet", "haiku"] as const).map((slot) => (
                        <div key={slot} className="flex items-center gap-2">
                          <span className="w-16 text-[12px] capitalize text-text-subtle">{slot}</span>
                          <Select value={slots[slot]} onChange={(e) => setSlots((s) => ({ ...s, [slot]: e.target.value }))} className="flex-1">
                            <option value="">— none —</option>
                            {allModels.map((m) => <option key={m} value={m}>{m}</option>)}
                          </Select>
                        </div>
                      ))}
                    </div>
                  </SetupRow>
                ) : (
                  <SetupRow label="Models" top>
                    <div>
                      <div className="flex min-h-[34px] flex-wrap gap-1.5 rounded-brand border border-border-subtle bg-bg px-2 py-1.5">
                        {picked.length === 0 ? (
                          <span className="text-[12px] text-text-subtle">No models — add one below.</span>
                        ) : (
                          picked.map((m) => (
                            <span
                              key={m}
                              onClick={() => setActive((a) => (a === m ? "" : m))}
                              title={m === active ? "active model — click to clear" : "click to set active"}
                              className={`inline-flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-[12px] transition-colors ${
                                m === active ? "border border-accent bg-accent-soft text-accent" : "border border-transparent bg-surface-2 text-text-muted hover:border-border"
                              }`}
                            >
                              {m === active && <Icon name="star" size={11} />}
                              <span className="tnum">{m}</span>
                              <button
                                onClick={(e) => { e.stopPropagation(); setPicked((p) => p.filter((x) => x !== m)); setActive((a) => (a === m ? "" : a)); }}
                                className="hover:text-danger"
                                aria-label={`Remove ${m}`}
                              >
                                <Icon name="close" size={12} />
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Select
                          value=""
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v && !picked.includes(v)) { setPicked((p) => [...p, v]); setActive((a) => a || v); }
                          }}
                          className="max-w-[260px]"
                        >
                          <option value="">Add a model…</option>
                          {allModels.filter((m) => !picked.includes(m)).map((m) => <option key={m} value={m}>{m}</option>)}
                        </Select>
                        <span className="text-[11.5px] text-text-subtle">
                          {active ? <>active: <span className="tnum text-accent">{active}</span></> : picked.length ? "click a chip to set active" : ""}
                        </span>
                      </div>
                    </div>
                  </SetupRow>
                )}

                {cli.configured && cli.baseUrl && (
                  <SetupRow label="Current">
                    <span className="tnum text-[11.5px] text-text-subtle">{cli.baseUrl}</span>
                  </SetupRow>
                )}

                <div className="flex items-center gap-2 border-t border-border-subtle pt-3">
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
                  {cli.path && <span className="ml-auto truncate tnum text-[11px] text-text-subtle">{cli.path}</span>}
                </div>
              </div>
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

        {!tool.autoConfig && (
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
        )}

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

/** label → control row used by the Local setup card (mirrors 9router's layout). */
function SetupRow({ label, children, top }: { label: string; children: React.ReactNode; top?: boolean }) {
  return (
    <div className={`grid grid-cols-[7rem_1fr] gap-3 ${top ? "items-start" : "items-center"}`}>
      <span className={`text-[12px] font-medium text-text-subtle ${top ? "pt-1.5" : ""}`}>{label}</span>
      <div className="min-w-0">{children}</div>
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
