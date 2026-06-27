"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import { useTheme } from "./ThemeProvider";
import { ConfirmModal } from "./ConfirmModal";
import { adminApi } from "@/lib/client";

const LABELS: Record<string, string> = {
  "": "Endpoint",
  endpoint: "Endpoint",
  keys: "Access Keys",
  providers: "Providers",
  combos: "Combos",
  usage: "Usage",
  quota: "Budgets",
  tools: "CLI Tools",
  console: "Server Console",
  config: "Settings",
};

const CMD = "npm i -g aigetwey@latest --prefer-online";

function UpdateModal({
  current,
  latest,
  onClose,
  onShutdown,
}: {
  current: string;
  latest: string;
  onClose: () => void;
  onShutdown: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(CMD).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-brand-lg border border-border bg-surface p-5 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-warning/10 text-warning">
              <Icon name="arrow_upward" size={19} />
            </span>
            <div>
              <h2 className="text-[14px] font-semibold text-text">Update available</h2>
              <p className="text-[12px] text-text-muted">
                v{current} → <span className="text-warning font-medium">v{latest}</span>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-text-subtle hover:text-text">
            <Icon name="close" size={17} />
          </button>
        </div>

        <p className="mb-3 text-[12.5px] text-text-muted">
          Run this command in your terminal to update:
        </p>

        <div className="flex items-center gap-2 rounded-brand border border-border bg-bg px-3 py-2">
          <code className="flex-1 text-[12px] text-text">{CMD}</code>
          <button
            onClick={copy}
            className="flex-none text-text-subtle transition-colors hover:text-text"
            title="Copy command"
          >
            <Icon name={copied ? "check" : "content_copy"} size={14} />
          </button>
        </div>

        <p className="mt-3 text-[11.5px] text-text-subtle">
          Shut down the gateway first, then run the command above, then restart.
        </p>

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => { copy(); onShutdown(); }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-brand border border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] font-medium text-warning transition-colors hover:bg-warning/20"
          >
            <Icon name="content_copy" size={14} />
            Copy &amp; Shut down
          </button>
          <button
            onClick={onClose}
            className="rounded-brand border border-border px-3 py-2 text-[12.5px] text-text-muted transition-colors hover:text-text"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}

export function TopBar() {
  const path = usePathname();
  const { theme, toggle } = useTheme();
  const seg = path === "/" ? "" : (path.split("/")[1] ?? "");
  const current = LABELS[seg] ?? seg;

  const [version, setVersion] = useState<{ current: string; latest: string | null; updateAvailable: boolean } | null>(null);
  const [showUpdate, setShowUpdate] = useState(false);
  const [confirmShutdown, setConfirmShutdown] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void adminApi.version().then((r) => {
      if (r.ok && r.data) setVersion(r.data);
    });
  }, []);

  async function doShutdown() {
    setBusy(true);
    await adminApi.shutdown();
    setStopped(true);
    setConfirmShutdown(false);
    setShowUpdate(false);
    setBusy(false);
  }

  return (
    <header className="console-topbar">
      <div className="flex items-center gap-2 text-[13px]">
        <span className="text-text-subtle">aigetwey</span>
        <span className="text-text-subtle">/</span>
        <span className="font-medium text-text">{current}</span>
      </div>

      <div className="ml-auto flex items-center gap-2.5">
        {version && (
          version.updateAvailable ? (
            <button
              onClick={() => setShowUpdate(true)}
              className="flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-warning transition-colors hover:bg-warning/20"
            >
              <Icon name="arrow_upward" size={12} />
              v{version.current} → {version.latest}
            </button>
          ) : (
            <span className="text-[11px] text-text-subtle" title="You're on the latest version">
              v{version.current}
            </span>
          )
        )}

        <button
          onClick={toggle}
          className="flex h-8 w-8 items-center justify-center rounded-full text-text-subtle transition-colors hover:text-text"
          aria-label="Toggle theme"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          <Icon name={theme === "dark" ? "light_mode" : "dark_mode"} size={18} />
        </button>

        <button
          onClick={() => setConfirmShutdown(true)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-text-subtle transition-colors hover:text-danger"
          aria-label="Shut down gateway"
          title="Shut down the gateway"
        >
          <Icon name="power_settings_new" size={18} />
        </button>

        <div className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-ink">
            A
          </span>
          <span className="text-[12px] text-text-muted">admin</span>
        </div>
      </div>

      {showUpdate && version?.updateAvailable && (
        <UpdateModal
          current={version.current}
          latest={version.latest!}
          onClose={() => setShowUpdate(false)}
          onShutdown={doShutdown}
        />
      )}

      {confirmShutdown && (
        <ConfirmModal
          title="Shut down gateway?"
          message="The gateway process will stop and all requests will fail until you restart it. The dashboard stays up but can't reach the gateway."
          confirmLabel="Shut down"
          busy={busy}
          onConfirm={doShutdown}
          onCancel={() => setConfirmShutdown(false)}
        />
      )}

      {stopped && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-sm rounded-brand-lg border border-border bg-surface p-5 text-center shadow-elevated">
            <span className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-danger/10 text-danger">
              <Icon name="power_settings_new" size={20} />
            </span>
            <h2 className="text-[15px] font-semibold text-text">Gateway stopped</h2>
            <p className="mt-1 text-[12.5px] text-text-muted">
              Run <code className="rounded bg-surface-2 px-1">{CMD}</code> then restart with <code className="rounded bg-surface-2 px-1">aigetwey</code>.
            </p>
          </div>
        </div>
      )}
    </header>
  );
}
