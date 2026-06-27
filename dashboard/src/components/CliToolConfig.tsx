"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/Badge";
import { Icon } from "@/components/Icon";
import { Empty } from "@/components/ui";
import { CLI_TOOLS } from "@/lib/cliTools";
import type { EndpointPayload } from "@/lib/gateway";

type DetectState = "loading" | "detected" | "not-detected";

export function CliToolConfig() {
  const [port, setPort] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [detect, setDetect] = useState<Record<string, DetectState>>({});

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/gw/admin/endpoint");
      if (!res.ok) {
        setError("could not reach the gateway");
        return;
      }
      setPort(((await res.json()) as EndpointPayload).port);

      const results = await Promise.all(
        CLI_TOOLS.map(async (t) => {
          try {
            const r = await fetch(`/api/cli-detect/${t.id}`);
            const data = await r.json();
            return [t.id, data.installed ? "detected" : "not-detected"] as const;
          } catch {
            return [t.id, "not-detected"] as const;
          }
        }),
      );
      setDetect(Object.fromEntries(results));
    })();
  }, []);

  if (error) return <Empty>{error}</Empty>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-text">CLI Tools</h1>
        <p className="mt-1 text-[13px] text-text-muted">
          Point your coding tools at the gateway. {port ? `Listening on port ${port}.` : ""}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CLI_TOOLS.map((t) => {
          const st = detect[t.id] ?? "loading";
          return (
            <Link
              key={t.id}
              href={`/tools/${t.id}`}
              className="group rounded-brand-lg border border-border bg-surface p-4 shadow-soft transition-colors hover:border-text-subtle"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-brand bg-surface-2 text-text-muted group-hover:text-text">
                    <Icon name={t.icon} size={18} />
                  </span>
                  <span className="text-[14px] font-semibold text-text">{t.name}</span>
                </span>
                {st === "loading" ? (
                  <Badge tone="neutral">…</Badge>
                ) : st === "detected" ? (
                  <Badge tone="live">detected</Badge>
                ) : (
                  <Badge tone="neutral">not detected</Badge>
                )}
              </div>
              <p className="mt-2 text-[12.5px] text-text-muted">{t.blurb}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-[12px] text-text-subtle group-hover:text-text">
                Setup <Icon name="arrow_forward" size={14} />
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
