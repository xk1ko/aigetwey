/**
 * Per-provider key pool with round-robin selection and exponential-backoff
 * cooldown. In-memory only (personal use — state need not survive restart).
 *
 * A key that hits a retryable failure is penalized: it goes on cooldown for
 * `base * 2^(failCount-1)` ms (capped), so a flaky/rate-limited key is skipped
 * for progressively longer while healthy keys keep serving.
 */
import type { Provider } from "../config.js";
import { maskKey } from "../config.js";

const COOLDOWN_CAP_MS = 5 * 60_000; // 5 minutes

interface KeyState {
  key: string;
  cooldownUntil: number;
  failCount: number;
}

interface ProviderPool {
  baseMs: number;
  cursor: number;
  states: KeyState[];
}

/**
 * Keys a provider routes through. A free/keyless provider (OpenCode Free, local
 * Ollama) gets one empty slot so it still routes — the upstream client omits the
 * auth header when the key is empty.
 */
function keysOf(provider: Provider): string[] {
  if (provider.api_keys && provider.api_keys.length > 0) return provider.api_keys;
  if (provider.api_key) return [provider.api_key];
  return [""];
}

export class KeyPool {
  private readonly pools = new Map<string, ProviderPool>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private poolFor(provider: Provider): ProviderPool {
    let pool = this.pools.get(provider.id);
    if (!pool) {
      pool = {
        baseMs: provider.cooldown_base_ms,
        cursor: 0,
        states: keysOf(provider).map((key) => ({ key, cooldownUntil: 0, failCount: 0 })),
      };
      this.pools.set(provider.id, pool);
    }
    return pool;
  }

  /**
   * Pick the next available (not-in-cooldown) key, round-robin.
   * Returns null when every key for this provider is cooling down.
   */
  pick(provider: Provider): string | null {
    const pool = this.poolFor(provider);
    const n = pool.states.length;
    const t = this.now();
    for (let i = 0; i < n; i++) {
      const idx = (pool.cursor + i) % n;
      const state = pool.states[idx]!;
      if (state.cooldownUntil <= t) {
        pool.cursor = (idx + 1) % n;
        return state.key;
      }
    }
    return null;
  }

  /** Mark a retryable failure: bump failCount and apply backoff cooldown. */
  penalize(provider: Provider, key: string): void {
    const pool = this.poolFor(provider);
    const state = pool.states.find((s) => s.key === key);
    if (!state) return;
    state.failCount += 1;
    const backoff = pool.baseMs * 2 ** (state.failCount - 1);
    state.cooldownUntil = this.now() + Math.min(backoff, COOLDOWN_CAP_MS);
  }

  /** Mark success: clear failure state so the key is healthy again. */
  success(provider: Provider, key: string): void {
    const state = this.poolFor(provider).states.find((s) => s.key === key);
    if (!state) return;
    state.failCount = 0;
    state.cooldownUntil = 0;
  }

  /** True if at least one key is currently usable. */
  hasAvailable(provider: Provider): boolean {
    const pool = this.poolFor(provider);
    const t = this.now();
    return pool.states.some((s) => s.cooldownUntil <= t);
  }

  /**
   * Read-only view of key health for the dashboard. Keys are MASKED — raw
   * secrets never leave the gateway. `cooldown_ms` is the remaining cooldown
   * (0 = healthy).
   */
  snapshot(providers: Provider[]): ProviderSnapshot[] {
    const t = this.now();
    return providers.map((provider) => {
      const pool = this.poolFor(provider);
      return {
        id: provider.id,
        format: provider.format,
        keys: pool.states.map((s) => ({
          key: maskKey(s.key),
          healthy: s.cooldownUntil <= t,
          cooldown_ms: Math.max(0, s.cooldownUntil - t),
          fail_count: s.failCount,
        })),
      };
    });
  }
}

export interface KeySnapshot {
  /** masked key, e.g. "sk-…cd12" */
  key: string;
  healthy: boolean;
  cooldown_ms: number;
  fail_count: number;
}

export interface ProviderSnapshot {
  id: string;
  format: Provider["format"];
  keys: KeySnapshot[];
}
