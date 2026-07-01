import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";
import { sealSession, isSessionValid, SESSION_COOKIE } from "./session";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-not-for-production";
});

describe("session", () => {
  it("has a port-scoped cookie name", () => {
    expect(SESSION_COOKIE).toMatch(/^aigloo_session_/);
  });

  it("a token sealed against a version validates against that same version", () => {
    const token = sealSession("v1");
    expect(isSessionValid(token, "v1")).toBe(true);
  });

  it("rejects when the current version no longer matches — the whole point of #3", () => {
    const token = sealSession("v1");
    // simulates a password rotation: AuthStore.version changed, cookie didn't
    expect(isSessionValid(token, "v2-after-password-change")).toBe(false);
  });

  it("never carries a recoverable password — payload only has v/iat", () => {
    const token = sealSession("some-version-fingerprint");
    const [payload] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    expect(Object.keys(decoded).sort()).toEqual(["iat", "v"]);
    expect(decoded.v).toBe("some-version-fingerprint");
  });

  it("rejects a tampered signature", () => {
    const token = sealSession("v1");
    const [payload] = token.split(".");
    const tampered = `${payload}.${"0".repeat(64)}`;
    expect(isSessionValid(tampered, "v1")).toBe(false);
  });

  it("rejects a tampered payload (re-signing a modified version claim)", () => {
    const token = sealSession("v1");
    const forgedPayload = Buffer.from(JSON.stringify({ v: "v2", iat: Date.now() }), "utf8").toString("base64url");
    const [, sig] = token.split(".");
    expect(isSessionValid(`${forgedPayload}.${sig}`, "v2")).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(isSessionValid(undefined, "v1")).toBe(false);
    expect(isSessionValid("", "v1")).toBe(false);
    expect(isSessionValid("not-a-valid-token", "v1")).toBe(false);
    expect(isSessionValid("missing-dot-separator", "v1")).toBe(false);
  });

  it("rejects when there's no current version at all (admin disabled)", () => {
    const token = sealSession("v1");
    expect(isSessionValid(token, "")).toBe(false);
  });

  it("rejects an expired token (defense in depth beyond the cookie's own Max-Age)", () => {
    const oldPayload = Buffer.from(
      JSON.stringify({ v: "v1", iat: Date.now() - 31 * 24 * 60 * 60 * 1000 }),
      "utf8",
    ).toString("base64url");
    const sig = createHmac("sha256", process.env.SESSION_SECRET as string).update(oldPayload).digest("hex");
    expect(isSessionValid(`${oldPayload}.${sig}`, "v1")).toBe(false);
  });
});
