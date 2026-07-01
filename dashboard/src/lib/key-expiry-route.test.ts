import { describe, it, expect, beforeAll } from "vitest";
import { RateLimiter } from "@/gw/core/ratelimit.js";
import type { gw } from "./gw";
import { authenticateV1 } from "./v1-handler";

/**
 * Rewrite of the old Fastify-based tests/key-expiry-route.test.ts (deleted in
 * the 1-port migration, 0b87eaf) — that drove requests through a real Fastify
 * server + registerV1Routes(). authenticateV1() is the exact function both
 * dispatchV1 and dispatchEmbeddings now share (see #2 in SECURITY_TODO.md),
 * so testing it directly covers both without needing a live server.
 *
 * Only `g.state.config.server.*` and `g.limiter` are touched by
 * authenticateV1 — build a minimal fake instead of driving the real gw()
 * singleton through actual config files and a real sqlite db.
 */
function fakeGw(server: { api_keys: string[]; key_expires?: Record<string, number>; key_rpm?: Record<string, number>; key_models?: Record<string, string[]> }) {
  return {
    state: { config: { server } },
    limiter: new RateLimiter(),
  } as unknown as ReturnType<typeof gw>;
}

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "x-aigloo-real-ip": "127.0.0.1", ...headers },
  });
}

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret";
});

describe("/v1 key expiry enforcement (authenticateV1)", () => {
  it("403s an expired key", async () => {
    const g = fakeGw({ api_keys: ["friend-key"], key_expires: { "friend-key": Date.now() - 1 } });
    const outcome = authenticateV1(req({ authorization: "Bearer friend-key" }), g);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.response.status).toBe(403);
      const body = await outcome.response.json();
      expect(body.error).toBe("access key expired");
    }
  });

  it("a non-expired key passes the expiry gate", () => {
    const g = fakeGw({ api_keys: ["friend-key"], key_expires: { "friend-key": Date.now() + 60_000 } });
    const outcome = authenticateV1(req({ authorization: "Bearer friend-key" }), g);
    expect(outcome.ok).toBe(true);
  });

  it("a key with no expiry entry never expires", () => {
    const g = fakeGw({ api_keys: ["friend-key"] });
    const outcome = authenticateV1(req({ authorization: "Bearer friend-key" }), g);
    expect(outcome.ok).toBe(true);
  });
});

describe("/v1 per-key rate limit (authenticateV1)", () => {
  it("429s once a key exceeds its key_rpm", () => {
    const g = fakeGw({ api_keys: ["friend-key"], key_rpm: { "friend-key": 2 } });
    const r = () => authenticateV1(req({ authorization: "Bearer friend-key" }), g);
    expect(r().ok).toBe(true);
    expect(r().ok).toBe(true);
    const third = r();
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.response.status).toBe(429);
  });

  it("a key with no key_rpm entry is never rate-limited", () => {
    const g = fakeGw({ api_keys: ["friend-key"] });
    const r = () => authenticateV1(req({ authorization: "Bearer friend-key" }), g);
    for (let i = 0; i < 10; i++) expect(r().ok).toBe(true);
  });
});
