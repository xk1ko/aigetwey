"use client";

import { useState } from "react";
import { Icon } from "./Icon";

/**
 * A masked key with an eye toggle that fetches the raw value on demand — for the
 * local operator who forgot what they pasted. `masked` is the already-masked
 * string the dashboard renders everywhere; `reveal` lazily fetches the real key
 * (admin-gated) the first time it's shown, then we cache it for copy/hide.
 */
export function KeyReveal({ masked, reveal }: { masked: string; reveal: () => Promise<string | null> }) {
  const [real, setReal] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function toggle() {
    if (shown) {
      setShown(false);
      return;
    }
    if (real === null) {
      setLoading(true);
      const k = await reveal();
      setLoading(false);
      if (k === null) return; // reveal failed — stay masked
      setReal(k);
    }
    setShown(true);
  }

  const display = shown && real !== null ? real : masked;

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="tnum truncate text-[12.5px] text-text">{display}</span>
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        className="flex-none text-text-subtle transition-colors hover:text-text disabled:opacity-40"
        aria-label={shown ? "Hide key" : "Show key"}
      >
        <Icon name={loading ? "hourglass_empty" : shown ? "visibility_off" : "visibility"} size={15} />
      </button>
      {shown && real !== null && (
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(real);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="flex-none text-text-subtle transition-colors hover:text-text"
          aria-label="Copy key"
        >
          <Icon name={copied ? "check" : "content_copy"} size={14} />
        </button>
      )}
    </span>
  );
}
