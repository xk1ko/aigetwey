import { describe, it, expect } from "vitest";
import { BudgetTracker } from "../src/core/budget.js";
import type { Budget } from "../src/config.js";

// minimal fake DB: returns a fixed window total regardless of `since`.
function fakeDb(tokens_in: number, tokens_out: number, cost: number) {
  return { summary: () => ({ total: { tokens_in, tokens_out, cost } }) };
}

const usd = (over: Partial<Budget> = {}): Budget =>
  ({ unit: "usd", limit: 10, window: "monthly", timezone: "UTC", ...over });
const tokensBudget = (over: Partial<Budget> = {}): Budget =>
  ({ unit: "tokens", limit: 1000, window: "monthly", timezone: "UTC", ...over });

describe("BudgetTracker", () => {
  it("returns null when no budget is configured", () => {
    const t = new BudgetTracker(() => undefined, fakeDb(0, 0, 0));
    expect(t.status()).toBeNull();
  });

  it("usd: computes spent, pct, and a token estimate from blended rate", () => {
    // cost $5 over 1000 tokens => rate $0.005/token; limit $10 => est 2000 tokens
    const t = new BudgetTracker(() => usd(), fakeDb(600, 400, 5), () => 0);
    const s = t.status()!;
    expect(s.spent).toBe(5);
    expect(s.pct).toBeCloseTo(0.5);
    expect(s.alert).toBe(false);
    expect(s.exhausted).toBe(false);
    expect(s.est_converse).toBeCloseTo(2000);
  });

  it("tokens: computes spent and a usd estimate from blended rate", () => {
    // 800 tokens for $4 => rate $0.005/token; limit 1000 tokens => est $5
    const t = new BudgetTracker(() => tokensBudget(), fakeDb(500, 300, 4), () => 0);
    const s = t.status()!;
    expect(s.spent).toBe(800);
    expect(s.pct).toBeCloseTo(0.8);
    expect(s.est_converse).toBeCloseTo(5);
  });

  it("alert flips at the default 0.8 threshold", () => {
    const t = new BudgetTracker(() => usd(), fakeDb(0, 0, 8), () => 0);
    expect(t.status()!.alert).toBe(true);
  });

  it("alert respects a custom alert_at", () => {
    const t = new BudgetTracker(() => usd({ alert_at: 0.95 }), fakeDb(0, 0, 9), () => 0);
    expect(t.status()!.alert).toBe(false); // 0.9 < 0.95
  });

  it("exhausted once spent >= limit; pct caps at 1", () => {
    const t = new BudgetTracker(() => usd(), fakeDb(0, 0, 12), () => 0);
    const s = t.status()!;
    expect(s.exhausted).toBe(true);
    expect(s.pct).toBe(1);
  });

  it("est_converse is null when the window has zero tokens", () => {
    const t = new BudgetTracker(() => usd(), fakeDb(0, 0, 0), () => 0);
    expect(t.status()!.est_converse).toBeNull();
  });

  it("caches status within cacheMs (one DB read per window)", () => {
    let calls = 0;
    const db = { summary: () => { calls++; return { total: { tokens_in: 0, tokens_out: 0, cost: 1 } }; } };
    let now = 0;
    const t = new BudgetTracker(() => usd(), db, () => now, 5000);
    t.status();
    t.status();
    expect(calls).toBe(1);   // second read served from cache
    now = 6000;
    t.status();
    expect(calls).toBe(2);   // cache expired
  });
});
