"use client";

import { useState, useEffect, useRef } from "react";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/Button";

const LOG_COLORS: Record<string, string> = {
  LOG: "text-success",
  INFO: "text-info",
  WARN: "text-warning",
  ERROR: "text-danger",
  DEBUG: "text-text-subtle",
};

const LEVEL_BG: Record<string, string> = {
  LOG: "bg-success/15 text-success",
  INFO: "bg-info/15 text-info",
  WARN: "bg-warning/15 text-warning",
  ERROR: "bg-danger/15 text-danger",
  DEBUG: "bg-surface-3 text-text-subtle",
};

interface LogEntry {
  ts: number;
  level: string;
  message: string;
}

export default function ConsolePage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource("/api/gw/admin/console/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        setLogs(msg.logs.slice(-300));
      } else if (msg.type === "line") {
        setLogs((prev) => {
          const next = [...prev, msg as LogEntry];
          return next.length > 300 ? next.slice(-300) : next;
        });
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleClear = async () => {
    await fetch("/api/gw/admin/console", { method: "DELETE" });
    setLogs([]);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight heading-gradient heading-accent">Server Console</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              autoScroll ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text"
            }`}
            title={autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}
          >
            <Icon name={autoScroll ? "vertical_align_bottom" : "vertical_align_top"} size={12} />
            Auto-scroll
          </button>
          <span className={`flex items-center gap-1.5 text-[11px] ${connected ? "text-success" : "text-danger"}`}>
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-success" : "bg-danger"}`} style={{ boxShadow: `0 0 4px 1px ${connected ? "var(--color-success)" : "var(--color-danger)"}` }} />
            {connected ? "Connected" : "Disconnected"}
          </span>
          <Button variant="ghost" onClick={handleClear}>
            <Icon name="delete" size={15} /> Clear
          </Button>
        </div>
      </div>

      {/* terminal */}
      <div className="overflow-hidden rounded-brand-lg card">
        {/* terminal chrome */}
        <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-danger/60" />
            <span className="h-3 w-3 rounded-full bg-warning/60" />
            <span className="h-3 w-3 rounded-full bg-success/60" />
          </div>
          <span className="ml-2 text-[11px] font-medium text-text-subtle">gateway — stdout</span>
          <span className="ml-auto tnum text-[11px] text-text-subtle">{logs.length} lines</span>
        </div>

        {/* log area */}
        <div
          ref={logRef}
          className="h-[calc(100vh-220px)] overflow-y-auto bg-[#06070b] p-4 font-mono text-[12px]"
        >
          {logs.length === 0 ? (
            <span className="text-text-subtle">No logs yet…</span>
          ) : (
            logs.map((entry, i) => (
              <div key={i} className="flex items-start gap-2 whitespace-pre-wrap break-all py-0.5">
                <span className="flex-none text-text-subtle">{new Date(entry.ts).toLocaleTimeString("en-US", { hour12: false })}</span>
                <span className={`flex-none rounded px-1 text-[10px] font-semibold uppercase ${LEVEL_BG[entry.level] ?? "bg-surface-3 text-text"}`}>
                  {entry.level}
                </span>
                <span className={`${LOG_COLORS[entry.level] ?? "text-text"}`}>{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
