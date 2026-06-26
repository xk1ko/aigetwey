type Tone = "live" | "down" | "warn" | "info" | "neutral" | "danger";

const TONES: Record<Tone, string> = {
  live: "bg-success/12 text-success",
  down: "bg-danger/12 text-danger",
  danger: "bg-danger/12 text-danger",
  warn: "bg-warning/12 text-warning",
  info: "bg-info/12 text-info",
  neutral: "bg-surface-2 text-text-muted",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}${className ? ` ${className}` : ""}`}
    >
      {children}
    </span>
  );
}

/** Format badge for a provider's wire format. */
export function FormatBadge({ format }: { format: "openai" | "anthropic" | "gemini" }) {
  return <Badge tone="info">{format}</Badge>;
}
