import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStore } from "../src/core/authStore.js";

describe("AuthStore", () => {
  it("seeds from the env password and verifies it", () => {
    const dir = mkdtempSync(join(tmpdir(), "aig-auth-"));
    const store = AuthStore.open(dir, "123456");
    expect(store.enabled).toBe(true);
    expect(store.verify("123456")).toBe(true);
    expect(store.verify("wrong")).toBe(false);
  });

  it("is disabled when there is nothing stored and no seed", () => {
    const dir = mkdtempSync(join(tmpdir(), "aig-auth-"));
    const store = AuthStore.open(dir, undefined);
    expect(store.enabled).toBe(false);
    expect(store.verify("anything")).toBe(false);
  });

  it("changes the password after verifying the current one, and persists", () => {
    const dir = mkdtempSync(join(tmpdir(), "aig-auth-"));
    const store = AuthStore.open(dir, "123456");

    expect(store.change("wrong", "newpass").ok).toBe(false);
    expect(store.change("123456", "no").ok).toBe(false); // too short
    expect(store.change("123456", "newpass").ok).toBe(true);
    expect(store.verify("newpass")).toBe(true);
    expect(store.verify("123456")).toBe(false);

    // a freshly opened store reads the persisted (changed) hash.
    const reopened = AuthStore.open(dir, "ignored-seed");
    expect(reopened.verify("newpass")).toBe(true);
  });
});
