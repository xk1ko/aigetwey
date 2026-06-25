import { describe, it, expect } from "vitest";
import { isValidKey, extractKey, checkAuth, checkAdminAuth, clientKeyFingerprint, matchKey } from "../src/middleware/auth.js";
import type { FastifyRequest } from "fastify";

/** Minimal FastifyRequest stand-in carrying just the headers auth reads. */
function reqWith(headers: Record<string, string>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

describe("isValidKey", () => {
  it("matches a key in the set", () => {
    expect(isValidKey("abc", ["abc", "def"])).toBe(true);
  });
  it("rejects a key not in the set", () => {
    expect(isValidKey("xyz", ["abc", "def"])).toBe(false);
  });
  it("rejects against an empty set", () => {
    expect(isValidKey("abc", [])).toBe(false);
  });
});

describe("extractKey", () => {
  it("reads a Bearer token", () => {
    expect(extractKey(reqWith({ authorization: "Bearer sk-123" }))).toBe("sk-123");
  });
  it("reads x-api-key", () => {
    expect(extractKey(reqWith({ "x-api-key": "sk-456" }))).toBe("sk-456");
  });
  it("returns null when neither header is present", () => {
    expect(extractKey(reqWith({}))).toBeNull();
  });
});

describe("checkAuth", () => {
  it("passes when no keys are configured (auth disabled)", () => {
    expect(checkAuth(reqWith({}), [])).toEqual({ ok: true });
  });
  it("401s on a missing key", () => {
    const r = checkAuth(reqWith({}), ["secret"]);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
  it("401s on a wrong key", () => {
    const r = checkAuth(reqWith({ authorization: "Bearer nope" }), ["secret"]);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
  it("passes a valid key via either header", () => {
    expect(checkAuth(reqWith({ authorization: "Bearer secret" }), ["secret"]).ok).toBe(true);
    expect(checkAuth(reqWith({ "x-api-key": "secret" }), ["secret"]).ok).toBe(true);
  });
});

describe("clientKeyFingerprint", () => {
  it("is 8 lowercase hex chars and stable for the same key", () => {
    const fp = clientKeyFingerprint("sk-abc");
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
    expect(clientKeyFingerprint("sk-abc")).toBe(fp);
  });
  it("differs for different keys", () => {
    expect(clientKeyFingerprint("sk-a")).not.toBe(clientKeyFingerprint("sk-b"));
  });
});

describe("matchKey", () => {
  it("returns the matching key, or null", () => {
    expect(matchKey("k2", ["k1", "k2", "k3"])).toBe("k2");
    expect(matchKey("nope", ["k1", "k2"])).toBeNull();
  });
});

describe("checkAuth keyFp", () => {
  const req = (key: string) => ({ headers: { authorization: `Bearer ${key}` } }) as never;
  it("surfaces the matched key's fingerprint", () => {
    const r = checkAuth(req("k2"), ["k1", "k2"]);
    expect(r.ok).toBe(true);
    expect(r.keyFp).toBe(clientKeyFingerprint("k2"));
  });
  it("no keyFp when auth is disabled (empty keys)", () => {
    const r = checkAuth(req("whatever"), []);
    expect(r.ok).toBe(true);
    expect(r.keyFp).toBeUndefined();
  });
});

describe("checkAdminAuth", () => {
  const verifier = (pw: string) => ({ enabled: true, verify: (k: string) => k === pw });
  it("503s when no admin password is set (locked, not open)", () => {
    const r = checkAdminAuth(reqWith({ authorization: "Bearer x" }), undefined);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
  });
  it("503s when the store is disabled", () => {
    const r = checkAdminAuth(reqWith({ authorization: "Bearer x" }), { enabled: false, verify: () => false });
    expect(r.status).toBe(503);
  });
  it("401s on a wrong password", () => {
    const r = checkAdminAuth(reqWith({ authorization: "Bearer wrong" }), verifier("pw"));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
  it("passes the correct password", () => {
    expect(checkAdminAuth(reqWith({ authorization: "Bearer pw" }), verifier("pw")).ok).toBe(true);
  });
});
