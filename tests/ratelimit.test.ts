import { describe, it, expect } from "vitest";
import { RateLimiter } from "../src/core/ratelimit.js";

describe("RateLimiter", () => {
  it("allows up to the limit, then trips over it within the same minute", () => {
    const rl = new RateLimiter();
    const t = 0;
    expect(rl.over("k", 2, t)).toBe(false); // 1st
    expect(rl.over("k", 2, t)).toBe(false); // 2nd
    expect(rl.over("k", 2, t)).toBe(true);  // 3rd > 2
  });

  it("resets the count when the minute boundary passes", () => {
    const rl = new RateLimiter();
    expect(rl.over("k", 1, 0)).toBe(false);       // minute 0
    expect(rl.over("k", 1, 0)).toBe(true);        // still minute 0, over
    expect(rl.over("k", 1, 60_000)).toBe(false);  // minute 1, reset
  });

  it("tracks keys independently", () => {
    const rl = new RateLimiter();
    expect(rl.over("a", 1, 0)).toBe(false);
    expect(rl.over("b", 1, 0)).toBe(false);
  });
});
