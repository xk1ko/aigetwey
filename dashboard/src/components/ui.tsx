/** Small formatting helpers shared across the console. */
export const fmt = {
  int(n: number): string {
    return n.toLocaleString("en-US");
  },
  /** compact number: 1.2K, 3.4M */
  compact(n: number): string {
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(Math.round(n));
  },
  cost(n: number): string {
    if (n === 0) return "$0";
    return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
  },
  time(ts: number): string {
    return new Date(ts).toLocaleString("en-US", { hour12: false });
  },
  /** DD/MM/YYYY (local) */
  date(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  },
  /** "3m", "2h", "5d" — coarse relative age */
  ago(ts: number): string {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  },
  /** ms duration -> "Xs", "Xm Ys", "Xh Ym" for budget/cooldown countdowns */
  duration(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h < 24) return `${h}h ${m}m`;
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  },
};

/** A labelled stat block — number over a caption. */
export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="card rounded-brand-lg px-4 py-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">{label}</div>
      <div className="mt-1 tnum text-[28px] font-bold tracking-tight text-text">{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-text-muted">{sub}</div>}
    </div>
  );
}

/** Empty-state hint inside a card body. */
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-1 py-8 text-center text-[13px] text-text-muted">{children}</div>;
}
