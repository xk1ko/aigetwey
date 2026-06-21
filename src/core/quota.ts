/**
 * Per-provider token quota tracking with scheduled window resets.
 *
 * Distinct from the key-pool cooldown: a cooldown is a transient penalty after a
 * 429; a quota is a budget that refills on a schedule (a 5-hour rolling window, a
 * daily/weekly/monthly calendar boundary). When a provider's `limit_tokens` is
 * reached before its window resets, routing skips it — like a key that's cooling
 * down, but for the whole provider.
 *
 * State is in-memory, optionally persisted so counts survive a restart within
 * the same window. Calendar boundaries are computed in the provider's timezone.
 */
import type { Provider, Quota } from "../config.js";

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Optional persistence hook so counts survive a restart within a window. */
export interface QuotaStore {
  load(): Array<{ provider_id: string; window_start: number; consumed: number }>;
  save(providerId: string, windowStart: number, consumed: number): void;
}

interface QuotaState {
  windowStart: number;
  consumed: number;
}

export interface QuotaSnapshot {
  provider: string;
  window: Quota["window"];
  consumed: number;
  limit_tokens?: number;
  /** ms until the next scheduled reset */
  reset_in_ms: number;
  /** 0..1 fraction of the limit used, if a limit is set */
  pct?: number;
  exhausted: boolean;
}

// ---- timezone-aware calendar math -----------------------------------------

/** Wall-clock offset (ms) of `tz` at instant `date`: tzWallAsUTC - actualUTC. */
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUTC - date.getTime();
}

/** Convert a desired wall-clock time in `tz` to an epoch ms. DST-corrected once. */
function zonedWallToEpoch(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guessUTC = Date.UTC(y, mo, d, h, mi);
  const offset = tzOffsetMs(new Date(guessUTC), tz);
  let epoch = guessUTC - offset;
  // re-check once: the offset can differ across a DST boundary
  const offset2 = tzOffsetMs(new Date(epoch), tz);
  if (offset2 !== offset) epoch = guessUTC - offset2;
  return epoch;
}

/** Wall-clock parts of `nowMs` in `tz`. */
function zonedParts(nowMs: number, tz: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(nowMs).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month) - 1,
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: String(p.weekday).toLowerCase(),
  };
}

function parseHHMM(reset_at: string | undefined): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(reset_at ?? "");
  if (!m) return { h: 0, m: 0 };
  return { h: Math.min(23, Number(m[1])), m: Math.min(59, Number(m[2])) };
}

/**
 * Next reset instant (epoch ms) strictly after `now` for a quota schedule.
 *   - 5h:      rolling — windowStart + 5h.
 *   - daily:   next `reset_at` (HH:MM, default 00:00) wall-clock in tz.
 *   - weekly:  next `reset_at` weekday (default monday) at 00:00 in tz.
 *   - monthly: next 1st of month at 00:00 in tz.
 */
export function nextResetAt(quota: Quota, windowStart: number, now: number): number {
  const tz = quota.timezone || "UTC";
  if (quota.window === "5h") return windowStart + 5 * HOUR_MS;

  const p = zonedParts(now, tz);

  if (quota.window === "daily") {
    const { h, m } = parseHHMM(quota.reset_at);
    let candidate = zonedWallToEpoch(p.year, p.month, p.day, h, m, tz);
    if (candidate <= now) candidate = zonedWallToEpoch(p.year, p.month, p.day + 1, h, m, tz);
    return candidate;
  }

  if (quota.window === "weekly") {
    const target = WEEKDAYS.indexOf((quota.reset_at ?? "monday").toLowerCase());
    const targetIdx = target === -1 ? 1 : target;
    const curIdx = WEEKDAYS.indexOf(p.weekday);
    let daysAhead = (targetIdx - curIdx + 7) % 7;
    let candidate = zonedWallToEpoch(p.year, p.month, p.day + daysAhead, 0, 0, tz);
    if (candidate <= now) candidate = zonedWallToEpoch(p.year, p.month, p.day + daysAhead + 7, 0, 0, tz);
    return candidate;
  }

  // monthly: first of next month at 00:00
  return zonedWallToEpoch(p.year, p.month + 1, 1, 0, 0, tz);
}

export class QuotaTracker {
  private readonly states = new Map<string, QuotaState>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly store?: QuotaStore,
  ) {
    if (store) {
      for (const row of store.load()) {
        this.states.set(row.provider_id, { windowStart: row.window_start, consumed: row.consumed });
      }
    }
  }

  /**
   * Return the live state for a provider, rolling the window over (resetting
   * consumed to 0) if `now` has crossed the scheduled reset boundary.
   */
  private current(provider: Provider): QuotaState | null {
    if (!provider.quota) return null;
    const t = this.now();
    const state = this.states.get(provider.id) ?? { windowStart: t, consumed: 0 };
    if (!this.states.has(provider.id)) this.states.set(provider.id, state);
    // boundary is the first reset AFTER this window opened — computed from
    // windowStart, not `now`. Computing it from `now` would always return the
    // NEXT future boundary and so never detect that we've crossed one.
    const reset = nextResetAt(provider.quota, state.windowStart, state.windowStart);
    if (t >= reset) {
      state.windowStart = t;
      state.consumed = 0;
      this.store?.save(provider.id, state.windowStart, state.consumed);
    }
    return state;
  }

  /** Add consumed tokens for a provider (no-op if it has no quota config). */
  consume(provider: Provider, tokens: number): void {
    const state = this.current(provider);
    if (!state) return;
    state.consumed += Math.max(0, tokens);
    this.store?.save(provider.id, state.windowStart, state.consumed);
  }

  /** True when a token limit is set AND it's been reached in the current window. */
  isExhausted(provider: Provider): boolean {
    const state = this.current(provider);
    if (!state || !provider.quota?.limit_tokens) return false;
    return state.consumed >= provider.quota.limit_tokens;
  }

  /** Dashboard view: window, consumed, countdown, and progress for each provider. */
  snapshot(providers: Provider[]): QuotaSnapshot[] {
    const t = this.now();
    return providers.flatMap((provider) => {
      if (!provider.quota) return [];
      const state = this.current(provider)!;
      const reset = nextResetAt(provider.quota, state.windowStart, t);
      const limit = provider.quota.limit_tokens;
      return [
        {
          provider: provider.id,
          window: provider.quota.window,
          consumed: state.consumed,
          limit_tokens: limit,
          reset_in_ms: Math.max(0, reset - t),
          pct: limit ? Math.min(1, state.consumed / limit) : undefined,
          exhausted: limit ? state.consumed >= limit : false,
        },
      ];
    });
  }
}
