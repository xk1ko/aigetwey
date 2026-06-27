/**
 * Scoped spend budgets, derived from the usage table (the single source of
 * truth) rather than a parallel counter. Each budget targets the whole gateway,
 * one provider, or one upstream model. statuses() computes every budget's spend
 * over its window; the result list is cached a few seconds so the per-request
 * hard-stop check stays cheap. blocks() answers "is a route to this
 * provider/model barred by an exhausted budget?".
 */
import type { Budget, BudgetScope } from "../config.js";
import { budgetKey } from "../config.js";
import { currentWindowStart, nextResetAt } from "./window.js";

export interface BudgetStatus {
  scope: BudgetScope;
  key: string;
  label: string;
  note?: string;
  unit: "usd" | "tokens";
  limit: number;
  spent: number;
  pct: number;
  alert: boolean;
  alert_at: number;
  exhausted: boolean;
  est_converse: number | null;
  reset_in_ms: number;
  window: Budget["window"];
}

interface TotalsReader {
  totals(sinceMs: number, filter?: { provider?: string; model?: string; client_key?: string }): {
    tokens_in: number;
    tokens_out: number;
    cost: number;
  };
}

function scopeLabel(scope: BudgetScope, keyName: (fp: string) => string): string {
  if (scope.type === "global") return "Global";
  if (scope.type === "key") return keyName(scope.id);
  return scope.id;
}

function scopeFilter(scope: BudgetScope): { provider?: string; model?: string; client_key?: string } | undefined {
  if (scope.type === "provider") return { provider: scope.id };
  if (scope.type === "model") return { model: scope.id };
  if (scope.type === "key") return { client_key: scope.id };
  return undefined;
}

export class BudgetTracker {
  private cached?: { at: number; list: BudgetStatus[] };

  constructor(
    private readonly getBudgets: () => Budget[],
    private readonly db: TotalsReader,
    private readonly now: () => number = Date.now,
    private readonly cacheMs = 5000,
    private readonly keyName: (fp: string) => string = (fp) => `key …${fp}`,
  ) {}

  clearCache(): void {
    this.cached = undefined;
  }

  statuses(): BudgetStatus[] {
    const t = this.now();
    if (this.cached && t - this.cached.at < this.cacheMs) return this.cached.list;
    const list = this.getBudgets().map((b) => this.compute(b, t));
    this.cached = { at: t, list };
    return list;
  }

  globalStatus(): BudgetStatus | null {
    return this.statuses().find((s) => s.scope.type === "global") ?? null;
  }

  /** First exhausted provider/model budget matching a route, or null. */
  blocks(providerId: string, model: string): { exhausted: true; reset_in_ms: number } | null {
    for (const s of this.statuses()) {
      if (!s.exhausted) continue;
      if (s.scope.type === "provider" && s.scope.id === providerId)
        return { exhausted: true, reset_in_ms: s.reset_in_ms };
      if (s.scope.type === "model" && s.scope.id === model)
        return { exhausted: true, reset_in_ms: s.reset_in_ms };
    }
    return null;
  }

  /** The exhausted key-scoped budget for this fingerprint, or null. */
  blocksKey(fp: string): { exhausted: true; reset_in_ms: number } | null {
    for (const s of this.statuses()) {
      if (s.exhausted && s.scope.type === "key" && s.scope.id === fp) {
        return { exhausted: true, reset_in_ms: s.reset_in_ms };
      }
    }
    return null;
  }

  private compute(spec: Budget, t: number): BudgetStatus {
    const windowStart = currentWindowStart(spec, t);
    const total = this.db.totals(windowStart, scopeFilter(spec.scope));
    const tokens = total.tokens_in + total.tokens_out;
    const cost = total.cost;
    const rate = tokens > 0 ? cost / tokens : undefined;
    const spent = spec.unit === "usd" ? cost : tokens;
    const limit = spec.limit;
    const pct = limit > 0 ? Math.min(1, spent / limit) : 0;
    const alertAt = spec.alert_at ?? 0.8;
    const remaining = Math.max(0, limit - spent);
    const est_converse = rate === undefined ? null : spec.unit === "usd" ? remaining / rate : remaining * rate;
    return {
      scope: spec.scope,
      key: budgetKey(spec.scope),
      label: scopeLabel(spec.scope, this.keyName),
      note: spec.note,
      unit: spec.unit,
      limit,
      spent,
      pct,
      alert: pct >= alertAt,
      alert_at: alertAt,
      exhausted: spent >= limit,
      est_converse,
      reset_in_ms: Math.max(0, nextResetAt(spec, windowStart) - t),
      window: spec.window,
    };
  }
}
