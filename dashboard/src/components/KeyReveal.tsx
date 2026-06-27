"use client";

import { useState } from "react";
import { Icon } from "./Icon";

/**
 * A masked key with an eye toggle that fetches the raw value on demand — for the
 * local operator who forgot what they pasted. `masked` is the already-masked
 * string the dashboard renders everywhere; `reveal` lazily fetches the real key
 * (admin-gated) the first time it's shown, then we cache it for copy/hide.
 */
/**
 * `align`: "inline" keeps the eye + copy right next to the key text (use in a
 * label/column context like Endpoint). "right" lets the text grow so the eye +
 * copy push to the right edge (use in a single-line row like Provider keys).
 */
export function KeyReveal({
  masked,
  reveal,
  className,
  align = "inline",
}: {
  masked: string;
  reveal: () => Promise<string | null>;
  className?: string;
  align?: "inline" | "right";
}) {
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
    <span className={`flex min-w-0 items-center gap-1.5${className ? ` ${className}` : ""}`}>
      <span className={`tnum truncate text-[13px] text-text${align === "right" ? " flex-1" : ""}`}>{display}</span>
      <button
        type="button"
        onClick={() => {
          if (real) {
            void navigator.clipboard.writeText(real);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }
        }}
        className={`flex-none text-text-subtle transition-colors hover:text-text${!shown || real === null ? " invisible" : ""}`}
        aria-label="Copy key"
      >
        <Icon name={copied ? "check" : "content_copy"} size={14} />
      </button>
      <button
        type="button"
        onClick={toggle}
        disabled={loading}
        className="flex-none text-text-subtle transition-colors hover:text-text disabled:opacity-40"
        aria-label={shown ? "Hide key" : "Show key"}
      >
        <Icon name={loading ? "hourglass_empty" : shown ? "visibility_off" : "visibility"} size={15} />
      </button>
    </span>
  );
}
