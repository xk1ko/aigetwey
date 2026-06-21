"use client";

import { usePathname } from "next/navigation";
import { Icon } from "./Icon";

const LABELS: Record<string, string> = {
  "": "Overview",
  endpoint: "Endpoint & Key",
  providers: "Providers & Keys",
  combos: "Combos & Routing",
  tools: "CLI Tools",
  usage: "Usage",
  logs: "Logs",
  config: "Config",
};

export function TopBar() {
  const path = usePathname();
  const seg = path === "/" ? "" : (path.split("/")[1] ?? "");
  const current = LABELS[seg] ?? seg;

  return (
    <header className="console-topbar">
      <div className="flex items-center gap-2 text-[13px]">
        <span className="text-text-subtle">aigetwey</span>
        <span className="text-text-subtle">/</span>
        <span className="font-medium text-text">{current}</span>
      </div>

      <div className="ml-auto flex items-center gap-2.5">
        <button className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] text-text-subtle transition-colors hover:text-text-muted">
          <Icon name="search" size={15} />
          <span>Search</span>
          <kbd className="ml-2 rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-subtle">
            ⌘K
          </kbd>
        </button>

        <div className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-ink">
            A
          </span>
          <span className="text-[12px] text-text-muted">admin</span>
        </div>
      </div>
    </header>
  );
}
