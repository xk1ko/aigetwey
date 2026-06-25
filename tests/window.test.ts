import { describe, it, expect } from "vitest";
import { nextResetAt, currentWindowStart, windowDuration } from "../src/core/window.js";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

describe("currentWindowStart (rolling buckets, epoch-aligned)", () => {
  it("5h: floors now to a 5-hour grid", () => {
    const now = 123 * 5 * HOUR + 1000;
    expect(currentWindowStart({ window: "5h" }, now)).toBe(123 * 5 * HOUR);
  });

  it("24h: floors now to a 24-hour grid", () => {
    const now = 200 * DAY + 5000;
    expect(currentWindowStart({ window: "24h" }, now)).toBe(200 * DAY);
  });

  it("7day: floors now to a 7-day grid", () => {
    const now = 10 * 7 * DAY + 99;
    expect(currentWindowStart({ window: "7day" }, now)).toBe(10 * 7 * DAY);
  });

  it("30day: floors now to a 30-day grid", () => {
    const now = 3 * 30 * DAY + 42;
    expect(currentWindowStart({ window: "30day" }, now)).toBe(3 * 30 * DAY);
  });
});

describe("nextResetAt", () => {
  it("resets at the end of the current bucket (windowStart + duration)", () => {
    expect(nextResetAt({ window: "5h" }, 1000, 1000)).toBe(1000 + 5 * HOUR);
    expect(nextResetAt({ window: "24h" }, 0, 0)).toBe(DAY);
    expect(nextResetAt({ window: "7day" }, 0, 0)).toBe(7 * DAY);
    expect(nextResetAt({ window: "30day" }, 0, 0)).toBe(30 * DAY);
  });
});

describe("windowDuration", () => {
  it("maps each window name to its length in ms", () => {
    expect(windowDuration({ window: "5h" })).toBe(5 * HOUR);
    expect(windowDuration({ window: "24h" })).toBe(DAY);
    expect(windowDuration({ window: "7day" })).toBe(7 * DAY);
    expect(windowDuration({ window: "30day" })).toBe(30 * DAY);
  });
});

describe("currentWindowStart (anchored cycles)", () => {
  it("anchored: bucket starts at anchor and tumbles by duration", () => {
    const anchor = 1_000_000;
    const dur = 24 * HOUR;
    const now = anchor + dur + dur / 2; // 1.5 cycles in
    expect(currentWindowStart({ window: "24h", anchor }, now)).toBe(anchor + dur);
  });

  it("anchored: before the anchor, the window starts at the anchor", () => {
    const anchor = 5_000_000;
    expect(currentWindowStart({ window: "5h", anchor }, anchor - 1000)).toBe(anchor);
  });

  it("anchored: exactly on a cycle boundary starts the new cycle", () => {
    const anchor = 0;
    const dur = 7 * DAY;
    expect(currentWindowStart({ window: "7day", anchor }, dur)).toBe(dur);
  });

  it("no anchor: falls back to the epoch grid (legacy budgets)", () => {
    const now = 123 * 5 * HOUR + 1000;
    expect(currentWindowStart({ window: "5h" }, now)).toBe(123 * 5 * HOUR);
  });
});

describe("nextResetAt (anchored)", () => {
  it("resets at the end of the anchored cycle", () => {
    const anchor = 1_000_000;
    const dur = 24 * HOUR;
    const start = anchor + dur;
    expect(nextResetAt({ window: "24h", anchor }, start, start + 5)).toBe(anchor + 2 * dur);
  });
});
