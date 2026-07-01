import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  it("rotates version on seed and on every change — session-invalidation binding", () => {
    const dir = mkdtempSync(join(tmpdir(), "aig-auth-"));
    const store = AuthStore.open(dir, "123456");
    const seeded = store.version;
    expect(seeded).toBeTruthy();

    store.change("123456", "newpass");
    expect(store.version).toBeTruthy();
    expect(store.version).not.toBe(seeded);

    const before = store.version;
    store.change("newpass", "another-pass");
    expect(store.version).not.toBe(before);
  });

  it("currentVersion() reads the version without booting a full AuthStore", () => {
    const dir = mkdtempSync(join(tmpdir(), "aig-auth-"));
    expect(AuthStore.currentVersion(dir)).toBe(""); // nothing seeded yet

    const store = AuthStore.open(dir, "123456");
    expect(AuthStore.currentVersion(dir)).toBe(store.version);

    store.change("123456", "newpass");
    expect(AuthStore.currentVersion(dir)).toBe(store.version);
  });

  it("upgrade path: a pre-existing record with no version gets one stamped in once", () => {
    const dir = mkdtempSync(join(tmpdir(), "aig-auth-"));
    AuthStore.open(dir, "123456");
    const record = JSON.parse(readFileSync(join(dir, "auth.json"), "utf8")) as {
      algo: string;
      salt: string;
      hash: string;
      version?: string;
    };
    // simulate a pre-upgrade file written before `version` existed
    const { version: _drop, ...withoutVersion } = record;
    writeFileSync(join(dir, "auth.json"), JSON.stringify(withoutVersion));
    expect(AuthStore.currentVersion(dir)).toBe("");

    const reopened = AuthStore.open(dir, undefined);
    expect(reopened.version).toBeTruthy();
    expect(AuthStore.currentVersion(dir)).toBe(reopened.version);
  });
});
