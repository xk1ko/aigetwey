import { describe, it, expect } from "vitest";
import { isValidKey, extractKey, checkAuth, checkAdminAuth, clientKeyFingerprint, matchKey } from "../src/middleware/auth.js";

function headersWith(h: Record<string, string>): Headers {
  return new Headers(h);
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
    expect(extractKey(headersWith({ authorization: "Bearer sk-123" }))).toBe("sk-123");
  });
  it("reads x-api-key", () => {
    expect(extractKey(headersWith({ "x-api-key": "sk-456" }))).toBe("sk-456");
  });
  it("returns null when neither header is present", () => {
    expect(extractKey(headersWith({}))).toBeNull();
  });
});

describe("checkAuth", () => {
  it("passes when no keys are configured (auth disabled)", () => {
    expect(checkAuth(headersWith({}), "127.0.0.1", [])).toEqual({ ok: true });
  });
  it("401s on a missing key", () => {
    const r = checkAuth(headersWith({}), "127.0.0.1", ["secret"]);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
  it("401s on a wrong key", () => {
    const r = checkAuth(headersWith({ authorization: "Bearer nope" }), "127.0.0.1", ["secret"]);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
  it("passes a valid key via either header", () => {
    expect(checkAuth(headersWith({ authorization: "Bearer secret" }), "127.0.0.1", ["secret"]).ok).toBe(true);
    expect(checkAuth(headersWith({ "x-api-key": "secret" }), "127.0.0.1", ["secret"]).ok).toBe(true);
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
  const req = (key: string) => headersWith({ authorization: `Bearer ${key}` });
  it("surfaces the matched key's fingerprint", () => {
    const r = checkAuth(req("k2"), "127.0.0.1", ["k1", "k2"]);
    expect(r.ok).toBe(true);
    expect(r.keyFp).toBe(clientKeyFingerprint("k2"));
  });
  it("no keyFp when auth is disabled (empty keys)", () => {
    const r = checkAuth(req("whatever"), "127.0.0.1", []);
    expect(r.ok).toBe(true);
    expect(r.keyFp).toBeUndefined();
  });
});

describe("checkAdminAuth", () => {
  const verifier = (pw: string) => ({ enabled: true, verify: (k: string) => k === pw });
  it("503s when no admin password is set (locked, not open)", () => {
    const r = checkAdminAuth(headersWith({ authorization: "Bearer x" }), undefined);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
  });
  it("503s when the store is disabled", () => {
    const r = checkAdminAuth(headersWith({ authorization: "Bearer x" }), { enabled: false, verify: () => false });
    expect(r.status).toBe(503);
  });
  it("401s on a wrong password", () => {
    const r = checkAdminAuth(headersWith({ authorization: "Bearer wrong" }), verifier("pw"));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });
  it("passes the correct password", () => {
    expect(checkAdminAuth(headersWith({ authorization: "Bearer pw" }), verifier("pw")).ok).toBe(true);
  });
});
