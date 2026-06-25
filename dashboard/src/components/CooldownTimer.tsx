"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { fmt } from "./ui";

/**
 * Live countdown from a gateway-snapshot remaining-ms. Counts down locally each
 * second from render. Used for both key cooldowns (danger tone) and budget window
 * resets (muted tone). Renders nothing once it hits zero unless `keepZero`.
 */
export function CooldownTimer({
  ms,
  tone = "danger",
  icon = "timer",
  keepZero = false,
}: {
  ms: number;
  tone?: "danger" | "muted";
  icon?: string;
  keepZero?: boolean;
}) {
  const [until] = useState(() => Date.now() + ms);
  const [remaining, setRemaining] = useState(() => Math.max(0, ms));

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, until - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [until]);

  if (remaining <= 0 && !keepZero) return null;

  const color = tone === "danger" ? "text-danger" : "text-text-muted";
  return (
    <span className={`inline-flex items-center gap-1 tnum text-[12px] ${color}`}>
      <Icon name={icon} size={13} />
      {remaining <= 0 ? "now" : fmt.duration(remaining)}
    </span>
  );
}
