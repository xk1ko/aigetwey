"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import { useTheme } from "./ThemeProvider";
import { ConfirmModal } from "./ConfirmModal";
import { adminApi } from "@/lib/client";

const LABELS: Record<string, string> = {
  "": "Endpoint & Key",
  endpoint: "Endpoint & Key",
  providers: "Providers",
  combos: "Combos",
  usage: "Usage",
  quota: "Budgets",
  tools: "CLI Tools",
  console: "Server Console",
  config: "Settings",
};

function CopyUpdateCmd({ version }: { version: string }) {
  const [copied, setCopied] = useState(false);
  const cmd = `npm install -g aigetwey@latest`;
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(cmd).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }); }}
      className="flex h-6 w-6 items-center justify-center rounded-full text-warning/70 transition-colors hover:bg-warning/10 hover:text-warning"
      title={`Copy: ${cmd}`}
    >
      <Icon name={copied ? "check" : "content_copy"} size={13} />
    </button>
  );
}

export function TopBar() {
  const path = usePathname();
  const { theme, toggle } = useTheme();
  const seg = path === "/" ? "" : (path.split("/")[1] ?? "");
  const current = LABELS[seg] ?? seg;

  const [version, setVersion] = useState<{ current: string; latest: string | null; updateAvailable: boolean } | null>(null);
  const [confirmShutdown, setConfirmShutdown] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [busy, setBusy] = useState(false);

  // version + update check on mount, via aigetwey's sidebar npm poll.
  useEffect(() => {
    void adminApi.version().then((r) => {
      if (r.ok && r.data) setVersion(r.data);
    });
  }, []);

  async function doShutdown() {
    setBusy(true);
    await adminApi.shutdown();
    // the gateway exits ~300ms after replying; reflect it in the UI.
    setStopped(true);
    setConfirmShutdown(false);
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
            <div className="flex items-center gap-1">
              <a
                href="https://github.com/xk1ko/aigetwey/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-warning transition-colors hover:bg-warning/20"
                title={`Update available — v${version.latest} is out (you have v${version.current})`}
              >
                <Icon name="arrow_upward" size={12} />
                v{version.latest} available
              </a>
              <CopyUpdateCmd version={version.latest!} />
            </div>
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

      {confirmShutdown && (
        <ConfirmModal
          title="Shut down gateway?"
          message="The gateway process will stop and all requests will fail until you restart it (run.sh). The dashboard stays up but can't reach the gateway."
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
              Restart it with <code className="rounded bg-surface-2 px-1">run.sh</code>, then reload this page.
            </p>
          </div>
        </div>
      )}
    </header>
  );
}
