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

interface LogEntry {
  ts: number;
  level: string;
  message: string;
}

export default function ConsolePage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
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
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const handleClear = async () => {
    await fetch("/api/gw/admin/console", { method: "DELETE" });
    setLogs([]);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-text">Server Console</h1>
          <p className="mt-1 text-[13px] text-text-muted">Live gateway process output.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-1.5 text-[11px] ${connected ? "text-success" : "text-danger"}`}>
            <Icon name={connected ? "radio_button_checked" : "radio_button_unchecked"} size={12} />
            {connected ? "Connected" : "Disconnected"}
          </span>
          <Button variant="ghost" onClick={handleClear}>
            <Icon name="delete" size={15} /> Clear
          </Button>
        </div>
      </div>

      <div
        ref={logRef}
        className="h-[calc(100vh-200px)] overflow-y-auto rounded-brand-lg border border-border bg-[#0a0a09] p-4 font-mono text-[12px]"
      >
        {logs.length === 0 ? (
          <span className="text-text-subtle">No logs yet…</span>
        ) : (
          logs.map((entry, i) => (
            <div key={i} className={`whitespace-pre-wrap break-all ${LOG_COLORS[entry.level] ?? "text-text"}`}>
              <span className="text-text-subtle">{new Date(entry.ts).toLocaleTimeString()} </span>
              <span className="font-semibold">[{entry.level}]</span> {entry.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
