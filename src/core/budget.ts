/**
 * Gateway-wide spend budget, derived from the usage table (the single source of
 * truth) rather than a parallel counter. status() sums cost/tokens over the
 * current window and reports spent / pct / alert / exhausted, plus an estimate
 * in the OTHER unit from the window's blended rate. The result is cached for a
 * few seconds so the per-request hard-stop check stays one DB query per window.
 */
import type { Budget } from "../config.js";
import { currentWindowStart, nextResetAt } from "./quota.js";

export interface BudgetStatus {
  unit: "usd" | "tokens";
  limit: number;
  spent: number;
  pct: number;
  alert: boolean;
  exhausted: boolean;
  /** estimate in the converse unit (tokens if unit=usd, usd if unit=tokens); null when no usage yet */
  est_converse: number | null;
  reset_in_ms: number;
  window: Budget["window"];
}

interface SummaryReader {
  summary(since: number): { total: { tokens_in: number; tokens_out: number; cost: number } };
}

export class BudgetTracker {
  private cached?: { at: number; status: BudgetStatus | null };

  constructor(
    private readonly getSpec: () => Budget | undefined,
    private readonly db: SummaryReader,
    private readonly now: () => number = Date.now,
    private readonly cacheMs = 5000,
  ) {}

  status(): BudgetStatus | null {
    const t = this.now();
    if (this.cached && t - this.cached.at < this.cacheMs) return this.cached.status;
    const status = this.compute(t);
    this.cached = { at: t, status };
    return status;
  }

  private compute(t: number): BudgetStatus | null {
    const spec = this.getSpec();
    if (!spec) return null;
    const windowStart = currentWindowStart(spec, t);
    const total = this.db.summary(windowStart).total;
    const tokens = total.tokens_in + total.tokens_out;
    const cost = total.cost;
    const rate = tokens > 0 ? cost / tokens : undefined; // $/token, blended over the window
    const spent = spec.unit === "usd" ? cost : tokens;
    const limit = spec.limit;
    const pct = limit > 0 ? Math.min(1, spent / limit) : 0;
    const est_converse = rate === undefined ? null : spec.unit === "usd" ? limit / rate : limit * rate;
    return {
      unit: spec.unit,
      limit,
      spent,
      pct,
      alert: pct >= (spec.alert_at ?? 0.8),
      exhausted: spent >= limit,
      est_converse,
      reset_in_ms: Math.max(0, nextResetAt(spec, windowStart, t) - t),
      window: spec.window,
    };
  }
}
