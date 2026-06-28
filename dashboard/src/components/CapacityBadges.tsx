"use client";

import { getCapabilitiesForModel, type Caps } from "@/lib/capabilities";
import { Icon } from "@/components/Icon";

/**
 * Per-model capability icons, aigloo's own CapacityBadges + CAPACITY_META.
 * Caps are DERIVED from the model id (not stored per-model) via the same resolver
 * aigloo uses, so badges match wherever the model appears. Only set caps render.
 */
const CAPACITY_META: Record<string, { icon: string; label: string; desc: string; color: string }> = {
  vision: { icon: "visibility", label: "Vision", desc: "Supports image input", color: "text-info" },
  reasoning: { icon: "neurology", label: "Reasoning", desc: "Supports reasoning / thinking", color: "text-warning" },
};

export function CapacityBadges({
  model,
  provider = null,
  size = 15,
  className = "",
}: {
  model: string;
  provider?: string | null;
  size?: number;
  className?: string;
}) {
  const caps = getCapabilitiesForModel(provider, model);
  const active = Object.keys(CAPACITY_META).filter((k) => caps[k as keyof Caps]);
  if (active.length === 0) return null;

  return (
    <span className={`inline-flex flex-none items-center gap-0.5 ${className}`}>
      {active.map((k) => (
        <span key={k} title={`${CAPACITY_META[k]!.label} — ${CAPACITY_META[k]!.desc}`} className="leading-none">
          <Icon name={CAPACITY_META[k]!.icon} size={size} className={CAPACITY_META[k]!.color} />
        </span>
      ))}
    </span>
  );
}
