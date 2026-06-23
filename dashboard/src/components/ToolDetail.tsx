"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RichCard, CardTitle } from "@/components/RichCard";
import { Badge } from "@/components/Badge";
import { Select } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Empty } from "@/components/ui";
import { adminApi } from "@/lib/client";
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
        <RichCard
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

        <RichCard header={<CardTitle title="Steps" />}>
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

        <RichCard className="lg:col-span-2" header={<CardTitle title="Models to call" sub="use one of these as the model name" />}>
          {combos.length === 0 ? (
            <Empty>No combos yet. Create one under Combos, or call a provider model directly as provider/model.</Empty>
          ) : (
            <div className="flex flex-wrap gap-2">
              {combos.map((c) => (
                <span key={c} className="tnum rounded-brand border border-border-subtle bg-bg px-2.5 py-1.5 text-[12.5px] text-text">
                  {c}
                </span>
              ))}
            </div>
          )}
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
