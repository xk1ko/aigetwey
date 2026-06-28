type Tone = "live" | "down" | "warn" | "info" | "neutral" | "danger";

const TONES: Record<Tone, string> = {
  live: "bg-success/10 text-success border border-success/15",
  down: "bg-danger/10 text-danger border border-danger/15",
  danger: "bg-danger/10 text-danger border border-danger/15",
  warn: "bg-warning/10 text-warning border border-warning/15",
  info: "bg-info/10 text-info border border-info/15",
  neutral: "glass text-text-muted",
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
