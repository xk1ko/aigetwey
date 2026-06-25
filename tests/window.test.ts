import { describe, it, expect } from "vitest";
import { nextResetAt, currentWindowStart } from "../src/core/window.js";

const HOUR = 3600_000;
const FIVE_H = 5 * HOUR;

describe("nextResetAt", () => {
  it("5h window is rolling from windowStart", () => {
    const q = { window: "5h" as const, timezone: "UTC" };
    expect(nextResetAt(q, 1000, 1000)).toBe(1000 + 5 * HOUR);
  });

  it("daily resets at the next HH:MM in the timezone", () => {
    const q = { window: "daily" as const, reset_at: "09:00", timezone: "UTC" };
    const now = Date.UTC(2026, 0, 1, 8, 0);
    const reset = nextResetAt(q, now, now);
    expect(reset).toBe(Date.UTC(2026, 0, 1, 9, 0));
  });

  it("daily rolls to tomorrow when past today's reset time", () => {
    const q = { window: "daily" as const, reset_at: "09:00", timezone: "UTC" };
    const now = Date.UTC(2026, 0, 1, 10, 0);
    const reset = nextResetAt(q, now, now);
    expect(reset).toBe(Date.UTC(2026, 0, 2, 9, 0));
  });

  it("weekly resets on the named weekday at 00:00", () => {
    const q = { window: "weekly" as const, reset_at: "monday", timezone: "UTC" };
    const now = Date.UTC(2026, 0, 1, 12, 0); // 2026-01-01 is a Thursday
    const reset = nextResetAt(q, now, now);
    expect(reset).toBe(Date.UTC(2026, 0, 5, 0, 0)); // next Monday
  });

  it("monthly resets on the 1st of next month at 00:00", () => {
    const q = { window: "monthly" as const, timezone: "UTC" };
    const now = Date.UTC(2026, 0, 15, 0, 0);
    const reset = nextResetAt(q, now, now);
    expect(reset).toBe(Date.UTC(2026, 1, 1, 0, 0));
  });

  it("honors a non-UTC timezone for the daily boundary", () => {
    const q = { window: "daily" as const, reset_at: "00:00", timezone: "Asia/Jakarta" };
    const now = Date.UTC(2026, 0, 1, 0, 0); // 07:00 WIB on Jan 1
    const reset = nextResetAt(q, now, now);
    expect(reset).toBe(Date.UTC(2026, 0, 1, 17, 0)); // next 00:00 WIB = 17:00 UTC
  });
});

describe("currentWindowStart", () => {
  it("monthly: start is the 1st of the current month (UTC)", () => {
    const now = Date.UTC(2026, 5, 20, 12, 0);
    const start = currentWindowStart({ window: "monthly", timezone: "UTC" }, now);
    expect(start).toBe(Date.UTC(2026, 5, 1, 0, 0));
  });

  it("daily: start is today's reset_at, or yesterday's if that is still ahead", () => {
    const now = Date.UTC(2026, 0, 1, 8, 0);
    const start = currentWindowStart({ window: "daily", reset_at: "09:00", timezone: "UTC" }, now);
    expect(start).toBe(Date.UTC(2025, 11, 31, 9, 0));
  });

  it("5h: start is the floor of now to a 5-hour grid", () => {
    const now = 123 * FIVE_H + 1000;
    expect(currentWindowStart({ window: "5h", timezone: "UTC" }, now)).toBe(123 * FIVE_H);
  });
});
