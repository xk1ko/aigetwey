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
import type { Provider } from "../config.js";
import { nextResetAt, type WindowSpec } from "./window.js";

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
  window: WindowSpec["window"];
  consumed: number;
  limit_tokens?: number;
  /** ms until the next scheduled reset */
  reset_in_ms: number;
  /** 0..1 fraction of the limit used, if a limit is set */
  pct?: number;
  exhausted: boolean;
  /** true when a limit is set and pct >= the quota's alert_at (default 0.8) */
  alert: boolean;
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
          alert: limit ? state.consumed / limit >= (provider.quota.alert_at ?? 0.8) : false,
        },
      ];
    });
  }
}
