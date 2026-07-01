import { describe, it, expect, vi, beforeEach } from "vitest";

const requestMock = vi.fn();
vi.mock("undici", () => ({ request: (...args: unknown[]) => requestMock(...args) }));

import { executeWithFallback } from "../src/core/fallback.js";
import { KeyPool } from "../src/core/keypool.js";
import { validateConfig, type ResolvedRoute } from "../src/config.js";
import type { CanonicalRequest } from "../src/core/canonical.js";

function routes(): ResolvedRoute[] {
  // alias "smart" -> [primary, backup]; each provider has its own keys.
  const cfg = validateConfig({
    providers: [
      { id: "primary", format: "openai", base_url: "https://p.test/v1", api_keys: ["pk1", "pk2"] },
      { id: "backup", format: "openai", base_url: "https://b.test/v1", api_key: "bk1" },
    ],
    models: [{ alias: "smart", target: ["primary", "backup"], model: "m" }],
  });
  return cfg.resolve("smart");
}

const REQ: CanonicalRequest = { model: "smart", messages: [{ role: "user", content: "hi" }] };

function ok(json: unknown) {
  return { statusCode: 200, body: { json: async () => json, text: async () => JSON.stringify(json), dump: async () => {} } };
}
function fail(status: number, body = "err") {
  return { statusCode: status, body: { json: async () => ({}), text: async () => body, dump: async () => {} } };
}

const REPLY = {
  id: "x",
  model: "m",
  created: 0,
  choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
};

beforeEach(() => requestMock.mockReset());

describe("executeWithFallback", () => {
  it("returns the first success without trying later providers", async () => {
    requestMock.mockResolvedValueOnce(ok(REPLY));
    const won = await executeWithFallback(routes(), new KeyPool(), REQ, { stream: false });
    expect(won.route.provider.id).toBe("primary");
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("retries the next key within a provider on a 429, then succeeds", async () => {
    requestMock.mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(ok(REPLY));
    const attempts: string[] = [];
    const won = await executeWithFallback(routes(), new KeyPool(), REQ, {
      stream: false,
      onAttempt: (a) => attempts.push(`${a.provider}:${a.outcome}`),
    });
    expect(won.route.provider.id).toBe("primary");
    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(attempts).toContain("primary:retry");
    expect(attempts).toContain("primary:success");
  });

  it("falls through to the backup provider when the primary is exhausted", async () => {
    // primary has 2 keys, both 429; then backup ok
    requestMock.mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(ok(REPLY));
    const won = await executeWithFallback(routes(), new KeyPool(), REQ, { stream: false });
    expect(won.route.provider.id).toBe("backup");
    expect(requestMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry more keys within the same provider on a non-retryable error (e.g. 400)", async () => {
    // primary's first key 400s (non-retryable) — should NOT try primary's second
    // key (pk2), should move straight to the backup provider instead.
    requestMock.mockResolvedValueOnce(fail(400, "bad request")).mockResolvedValueOnce(ok(REPLY));
    const won = await executeWithFallback(routes(), new KeyPool(), REQ, { stream: false });
    expect(won.route.provider.id).toBe("backup");
    expect(requestMock).toHaveBeenCalledTimes(2); // primary (1 try, no retry) + backup
  });

  it("still throws when a non-retryable error hits the last route in the chain", async () => {
    // both providers in the chain get a non-retryable 400 — nothing left to fall back to.
    requestMock.mockResolvedValueOnce(fail(400, "bad request")).mockResolvedValueOnce(fail(400, "bad request"));
    await expect(executeWithFallback(routes(), new KeyPool(), REQ, { stream: false })).rejects.toMatchObject({
      status: 400,
    });
    expect(requestMock).toHaveBeenCalledTimes(2); // one try per provider, no same-provider retries
  });

  it("treats a network error as retryable and falls through", async () => {
    requestMock
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(ok(REPLY));
    const won = await executeWithFallback(routes(), new KeyPool(), REQ, { stream: false });
    expect(won.route.provider.id).toBe("backup");
  });

  it("throws 503 when the whole chain is exhausted via cooldown", async () => {
    const pool = new KeyPool();
    // pre-cool every key so pick() returns null for both providers
    const [primary, backup] = [routes()[0]!.provider, routes()[1]!.provider];
    pool.penalize(primary, "pk1");
    pool.penalize(primary, "pk2");
    pool.penalize(backup, "bk1");
    await expect(executeWithFallback(routes(), pool, REQ, { stream: false })).rejects.toMatchObject({ status: 503 });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("reports the served route + key via onServed", async () => {
    requestMock.mockResolvedValueOnce(ok(REPLY));
    let served: { id: string; key: string } | null = null;
    await executeWithFallback(routes(), new KeyPool(), REQ, {
      stream: false,
      onServed: (route, key) => (served = { id: route.provider.id, key }),
    });
    expect(served).toEqual({ id: "primary", key: "pk1" });
  });
});
