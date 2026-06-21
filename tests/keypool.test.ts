import { describe, it, expect } from "vitest";
import { KeyPool } from "../src/core/keypool.js";
import { validateConfig, type Provider } from "../src/config.js";

/** A provider with the given keys and cooldown base, fully defaulted. */
function provider(id: string, keys: string[], cooldownBase = 1000, maxRetries = 2): Provider {
  const cfg = validateConfig({
    providers: [
      {
        id,
        format: "openai",
        base_url: "https://x.test/v1",
        api_keys: keys,
        cooldown_base_ms: cooldownBase,
        max_retries: maxRetries,
      },
    ],
  });
  return cfg.getProvider(id)!;
}

/** Controllable clock so cooldown timing is deterministic. */
function clock() {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("KeyPool.pick — round-robin", () => {
  it("rotates across healthy keys", () => {
    const pool = new KeyPool();
    const p = provider("p", ["k1", "k2", "k3"]);
    expect(pool.pick(p)).toBe("k1");
    expect(pool.pick(p)).toBe("k2");
    expect(pool.pick(p)).toBe("k3");
    expect(pool.pick(p)).toBe("k1");
  });

  it("gives a single empty slot for a keyless/free provider", () => {
    const cfg = validateConfig({
      providers: [{ id: "free", format: "openai", base_url: "https://x.test/v1", free: true }],
    });
    const pool = new KeyPool();
    expect(pool.pick(cfg.getProvider("free")!)).toBe("");
  });
});

describe("KeyPool — cooldown + backoff", () => {
  it("skips a penalized key until its cooldown elapses", () => {
    const c = clock();
    const pool = new KeyPool(c.now);
    const p = provider("p", ["k1", "k2"], 1000);

    expect(pool.pick(p)).toBe("k1");
    pool.penalize(p, "k1"); // cooldown 1000ms (base * 2^0)
    // k1 is cooling down, so the only healthy key is k2
    expect(pool.pick(p)).toBe("k2");
    expect(pool.pick(p)).toBe("k2");

    c.advance(1000);
    // k1 healthy again, round-robin resumes
    expect(pool.pick(p)).toBe("k1");
  });

  it("doubles the cooldown on consecutive failures (exponential backoff)", () => {
    const c = clock();
    const pool = new KeyPool(c.now);
    const p = provider("p", ["only"], 1000);

    pool.penalize(p, "only"); // 1000ms
    expect(pool.pick(p)).toBeNull();
    c.advance(1000);
    expect(pool.pick(p)).toBe("only");

    // pick() does not reset failCount, so the next penalize is the 2nd failure
    // -> base * 2^1 = 2000ms backoff.
    pool.penalize(p, "only");
    expect(pool.pick(p)).toBeNull();
    c.advance(1000);
    expect(pool.pick(p)).toBeNull(); // still cooling (needs 2000ms)
    c.advance(1000);
    expect(pool.pick(p)).toBe("only");
  });

  it("success clears failure state", () => {
    const c = clock();
    const pool = new KeyPool(c.now);
    const p = provider("p", ["k"], 1000);
    pool.penalize(p, "k");
    pool.success(p, "k");
    expect(pool.pick(p)).toBe("k"); // no cooldown after success
  });

  it("returns null when every key is cooling down", () => {
    const pool = new KeyPool();
    const p = provider("p", ["k1", "k2"]);
    pool.penalize(p, "k1");
    pool.penalize(p, "k2");
    expect(pool.pick(p)).toBeNull();
    expect(pool.hasAvailable(p)).toBe(false);
  });
});

describe("KeyPool.snapshot — masked for the dashboard", () => {
  it("masks keys and reports health + cooldown", () => {
    const c = clock();
    const pool = new KeyPool(c.now);
    const p = provider("p", ["sk-abcdefghijkl"], 2000);
    pool.penalize(p, "sk-abcdefghijkl");
    const snap = pool.snapshot([p]);
    expect(snap[0]!.keys[0]!.key).not.toContain("abcdefghijkl"); // masked
    expect(snap[0]!.keys[0]!.healthy).toBe(false);
    expect(snap[0]!.keys[0]!.cooldown_ms).toBe(2000);
    expect(snap[0]!.keys[0]!.fail_count).toBe(1);
  });
});
