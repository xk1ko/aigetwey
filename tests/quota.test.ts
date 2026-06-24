import { describe, it, expect } from "vitest";
import { QuotaTracker, nextResetAt, currentWindowStart } from "../src/core/quota.js";
import { validateConfig, type Provider, type Quota } from "../src/config.js";

function providerWithQuota(quota: Quota): Provider {
  const cfg = validateConfig({
    providers: [{ id: "p", format: "openai", base_url: "https://x.test/v1", api_key: "k", quota }],
  });
  return cfg.getProvider("p")!;
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;

describe("nextResetAt", () => {
  it("5h window is rolling from windowStart", () => {
    const q: Quota = { window: "5h", timezone: "UTC" };
    expect(nextResetAt(q, 1000, 1000)).toBe(1000 + 5 * HOUR);
  });

  it("daily resets at the next HH:MM in the timezone", () => {
    const q: Quota = { window: "daily", reset_at: "10:00", timezone: "UTC" };
    // 2024-01-01T08:00:00Z -> next reset is 2024-01-01T10:00:00Z
    const now = Date.UTC(2024, 0, 1, 8, 0);
    const reset = nextResetAt(q, now, now);
    expect(reset).toBe(Date.UTC(2024, 0, 1, 10, 0));
  });

  it("daily rolls to tomorrow when past today's reset time", () => {
    const q: Quota = { window: "daily", reset_at: "10:00", timezone: "UTC" };
    const now = Date.UTC(2024, 0, 1, 11, 0); // past 10:00
    const reset = nextResetAt(q, now, now);
    expect(reset).toBe(Date.UTC(2024, 0, 2, 10, 0));
  });

  it("weekly resets on the named weekday at 00:00", () => {
    const q: Quota = { window: "weekly", reset_at: "monday", timezone: "UTC" };
    // 2024-01-03 is a Wednesday; next Monday is 2024-01-08
    const now = Date.UTC(2024, 0, 3, 12, 0);
    const reset = nextResetAt(q, now, now);
    expect(reset).toBe(Date.UTC(2024, 0, 8, 0, 0));
  });

  it("monthly resets on the 1st of next month at 00:00", () => {
    const q: Quota = { window: "monthly", timezone: "UTC" };
    const now = Date.UTC(2024, 0, 15, 12, 0);
    const reset = nextResetAt(q, now, now);
    expect(reset).toBe(Date.UTC(2024, 1, 1, 0, 0));
  });

  it("honors a non-UTC timezone for the daily boundary", () => {
    const q: Quota = { window: "daily", reset_at: "00:00", timezone: "Asia/Jakarta" }; // UTC+7
    // Jakarta midnight = 17:00 UTC the previous day.
    const now = Date.UTC(2024, 0, 1, 10, 0); // 17:00 Jakarta on Jan 1
    const reset = nextResetAt(q, now, now);
    // next Jakarta midnight is Jan 2 00:00 +07 = Jan 1 17:00 UTC
    expect(reset).toBe(Date.UTC(2024, 0, 1, 17, 0));
  });
});

describe("QuotaTracker.consume + isExhausted", () => {
  it("is never exhausted without a token limit", () => {
    const p = providerWithQuota({ window: "daily", timezone: "UTC" });
    const q = new QuotaTracker(() => 1000);
    q.consume(p, 1_000_000);
    expect(q.isExhausted(p)).toBe(false);
  });

  it("exhausts once consumed reaches the limit", () => {
    const p = providerWithQuota({ window: "daily", reset_at: "00:00", timezone: "UTC", limit_tokens: 100 });
    const q = new QuotaTracker(() => 1000);
    q.consume(p, 60);
    expect(q.isExhausted(p)).toBe(false);
    q.consume(p, 50); // 110 >= 100
    expect(q.isExhausted(p)).toBe(true);
  });

  it("resets consumed when the window boundary passes", () => {
    let t = Date.UTC(2024, 0, 1, 8, 0);
    const p = providerWithQuota({ window: "daily", reset_at: "10:00", timezone: "UTC", limit_tokens: 100 });
    const q = new QuotaTracker(() => t);
    q.consume(p, 100);
    expect(q.isExhausted(p)).toBe(true);
    t = Date.UTC(2024, 0, 1, 10, 1); // crossed 10:00 reset
    expect(q.isExhausted(p)).toBe(false); // window rolled, consumed reset
  });

  it("ignores providers with no quota config", () => {
    const cfg = validateConfig({ providers: [{ id: "n", format: "openai", base_url: "https://x.test/v1", api_key: "k" }] });
    const p = cfg.getProvider("n")!;
    const q = new QuotaTracker(() => 1000);
    expect(() => q.consume(p, 50)).not.toThrow();
    expect(q.isExhausted(p)).toBe(false);
  });
});

describe("QuotaTracker.snapshot", () => {
  it("reports consumed, limit, countdown, and pct", () => {
    const t = Date.UTC(2024, 0, 1, 8, 0);
    const p = providerWithQuota({ window: "daily", reset_at: "10:00", timezone: "UTC", limit_tokens: 1000 });
    const q = new QuotaTracker(() => t);
    q.consume(p, 250);
    const snap = q.snapshot([p]);
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ provider: "p", window: "daily", consumed: 250, limit_tokens: 1000, exhausted: false });
    expect(snap[0]!.pct).toBeCloseTo(0.25);
    expect(snap[0]!.reset_in_ms).toBe(2 * HOUR); // 08:00 -> 10:00
  });

  it("omits providers without a quota", () => {
    const cfg = validateConfig({ providers: [{ id: "n", format: "openai", base_url: "https://x.test/v1", api_key: "k" }] });
    expect(new QuotaTracker().snapshot([cfg.getProvider("n")!])).toEqual([]);
  });
});

describe("QuotaTracker — persistence via a store", () => {
  it("restores consumed counts from the store on construction", () => {
    const p = providerWithQuota({ window: "daily", reset_at: "10:00", timezone: "UTC", limit_tokens: 100 });
    const saved: Array<{ provider_id: string; window_start: number; consumed: number }> = [];
    const now = Date.UTC(2024, 0, 1, 8, 0);
    const store = {
      load: () => [{ provider_id: "p", window_start: now, consumed: 90 }],
      save: (provider_id: string, window_start: number, consumed: number) =>
        saved.push({ provider_id, window_start, consumed }),
    };
    const q = new QuotaTracker(() => now, store);
    // 90 restored; +20 crosses the 100 limit
    q.consume(p, 20);
    expect(q.isExhausted(p)).toBe(true);
    expect(saved.at(-1)).toMatchObject({ provider_id: "p", consumed: 110 });
  });
});

describe("currentWindowStart", () => {
  it("monthly: start is the 1st of the current month (UTC)", () => {
    const now = Date.UTC(2026, 5, 24, 15, 30); // 2026-06-24 15:30 UTC
    const start = currentWindowStart({ window: "monthly", timezone: "UTC" }, now);
    expect(start).toBe(Date.UTC(2026, 5, 1, 0, 0));
  });

  it("daily: start is today's reset_at, or yesterday's if that is still ahead", () => {
    const now = Date.UTC(2026, 5, 24, 2, 0); // 02:00 UTC, before a 09:00 reset
    const start = currentWindowStart({ window: "daily", reset_at: "09:00", timezone: "UTC" }, now);
    expect(start).toBe(Date.UTC(2026, 5, 23, 9, 0)); // yesterday 09:00
  });

  it("5h: start is the floor of now to a 5-hour grid", () => {
    const FIVE_H = 5 * 3600_000;
    const now = 123 * FIVE_H + 42_000;
    expect(currentWindowStart({ window: "5h", timezone: "UTC" }, now)).toBe(123 * FIVE_H);
  });
});

describe("snapshot alert flag", () => {
  const provider = (alert_at?: number): Provider =>
    ({ id: "p", format: "openai", base_url: "https://x.test", api_keys: ["k"],
       free: false, auto_models: false, models: [], cooldown_base_ms: 1000, max_retries: 2,
       quota: { window: "daily", timezone: "UTC", limit_tokens: 1000, alert_at } } as unknown as Provider);

  it("flags alert once consumption crosses alert_at", () => {
    let t = 1_000_000;
    const tr = new QuotaTracker(() => t);
    tr.consume(provider(0.8), 850);
    const snap = tr.snapshot([provider(0.8)])[0]!;
    expect(snap.alert).toBe(true);
  });

  it("uses the 0.8 default when alert_at is unset", () => {
    const tr = new QuotaTracker(() => 1_000_000);
    tr.consume(provider(), 700);
    expect(tr.snapshot([provider()])[0]!.alert).toBe(false); // 0.7 < 0.8
    tr.consume(provider(), 150);
    expect(tr.snapshot([provider()])[0]!.alert).toBe(true);  // 0.85 >= 0.8
  });
});
