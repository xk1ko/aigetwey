import { describe, it, expect } from "vitest";
import { QuotaTracker } from "../src/core/quota.js";
import { validateConfig, type Provider, type Quota } from "../src/config.js";

function providerWithQuota(quota: Quota): Provider {
  const cfg = validateConfig({
    providers: [{ id: "p", format: "openai", base_url: "https://x.test/v1", api_key: "k", quota }],
  });
  return cfg.getProvider("p")!;
}

const HOUR = 3600_000;

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

