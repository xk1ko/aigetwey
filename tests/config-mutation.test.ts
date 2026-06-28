import { describe, it, expect } from "vitest";
import {
  validateConfig,
  addProvider,
  editProvider,
  removeProvider,
  addProviderKey,
  removeProviderKey,
  addProviderModel,
  removeProviderModel,
  addProviderModels,
  clearProviderModels,
  setRoute,
  removeRoute,
  setRtk,
  setCaveman,
  setPonytail,
  addServerKey,
  editServerKey,
  removeServerKey,
  setServerKeyScope,
  renameProvider,
  maskKey,
  setBudget,
  clearBudget,
  budgetKey,
  clientKeyFingerprint,
  isKeyExpired,
  type Config,
} from "../src/config.js";

/** A base config: two providers, one routing alias. Re-validated each call. */
function base() {
  return validateConfig({
    server: { api_keys: ["gw-1"] },
    providers: [
      { id: "oa", format: "openai", base_url: "https://oa.test/v1", api_key: "sk-oa" },
      { id: "an", format: "anthropic", base_url: "https://an.test/v1", api_keys: ["sk-an-1", "sk-an-2"] },
    ],
    models: [{ alias: "smart", target: ["oa", "an"], model: ["gpt-4o", "claude-3"] }],
  }).raw;
}

// helpers return a NEW Config; re-validate to confirm the result is still legal.
const reval = (c: ReturnType<typeof base>) => validateConfig(c);

describe("provider mutations", () => {
  it("addProvider appends with defaults, rejects duplicates", () => {
    const c = addProvider(base(), { id: "groq", format: "openai", base_url: "https://groq.test/v1", api_key: "k" });
    const p = reval(c).getProvider("groq")!;
    expect(p.api_keys).toEqual(["k"]);
    expect(() => addProvider(c, { id: "groq", format: "openai", base_url: "https://x.test/v1" })).toThrow(/already exists/);
  });

  it("addProvider supports free + service_account", () => {
    const free = addProvider(base(), { id: "oc", format: "openai", base_url: "https://oc.test/v1", free: true, auto_models: true });
    expect(reval(free).getProvider("oc")!.free).toBe(true);
    const v = addProvider(base(), { id: "vx", format: "gemini", base_url: "https://vx.test/v1", service_account: "/sa.json" });
    expect(reval(v).getProvider("vx")!.service_account).toBe("/sa.json");
  });

  it("editProvider changes base_url/format, not id", () => {
    const c = editProvider(base(), "oa", { base_url: "https://new.test/v1", format: "anthropic" });
    const p = reval(c).getProvider("oa")!;
    expect(p.base_url).toBe("https://new.test/v1");
    expect(p.format).toBe("anthropic");
  });

  it("removeProvider refuses while a route targets it", () => {
    expect(() => removeProvider(base(), "oa")).toThrow(/used in combos\/routing/);
  });

  it("removeProvider works once no route targets it", () => {
    const c = removeRoute(base(), "smart");
    const after = removeProvider(c, "oa");
    expect(reval(after).getProvider("oa")).toBeUndefined();
  });
});

describe("provider key mutations", () => {
  it("addProviderKey appends and normalizes to api_keys", () => {
    const c = addProviderKey(base(), "oa", "sk-oa-2");
    expect(reval(c).getProvider("oa")!.api_keys).toEqual(["sk-oa", "sk-oa-2"]);
  });

  it("removeProviderKey drops one but guards the last key of a keyed provider", () => {
    const c = removeProviderKey(base(), "an", 0);
    expect(reval(c).getProvider("an")!.api_keys).toEqual(["sk-an-2"]);
    // oa has a single key -> removing it is refused
    expect(() => removeProviderKey(base(), "oa", 0)).toThrow(/last key/);
  });

  it("allows removing the last key of a free provider", () => {
    let c = addProvider(base(), { id: "oc", format: "openai", base_url: "https://oc.test/v1", free: true, api_key: "tmp" });
    c = removeProviderKey(c, "oc", 0);
    expect(reval(c).getProvider("oc")!.api_keys).toEqual([]);
  });
});

describe("provider model catalog", () => {
  it("add + remove a model, reject duplicate / unknown", () => {
    const c = addProviderModel(base(), "oa", "gpt-4o-mini", { price_in: 0.15, price_out: 0.6 });
    expect(reval(c).getProvider("oa")!.models.find((m) => m.id === "gpt-4o-mini")?.price_in).toBe(0.15);
    expect(() => addProviderModel(c, "oa", "gpt-4o-mini")).toThrow(/already serves/);
    const back = removeProviderModel(c, "oa", "gpt-4o-mini");
    expect(reval(back).getProvider("oa")!.models.some((m) => m.id === "gpt-4o-mini")).toBe(false);
    expect(() => removeProviderModel(base(), "oa", "ghost")).toThrow(/does not serve/);
  });

  it("addProviderModels adds many at once, skipping ones already present", () => {
    let c = addProviderModel(base(), "oa", "keep");
    c = addProviderModels(c, "oa", ["a", "b", "keep", "c", " "]);
    const ids = reval(c).getProvider("oa")!.models.map((m) => m.id);
    expect(ids).toEqual(["keep", "a", "b", "c"]); // "keep" not duplicated, blank skipped
  });

  it("clearProviderModels empties the catalog", () => {
    const c = clearProviderModels(addProviderModels(base(), "oa", ["x", "y", "z"]), "oa");
    expect(reval(c).getProvider("oa")!.models).toEqual([]);
  });
});

describe("routing aliases", () => {
  it("setRoute creates a new alias targeting known providers", () => {
    const c = setRoute(base(), { alias: "fast", target: ["oa"], model: "gpt-4o-mini", price_in: 1, price_out: 2 });
    const chain = reval(c).resolve("fast");
    expect(chain).toHaveLength(1);
    expect(chain[0]!.model).toBe("gpt-4o-mini");
  });

  it("setRoute replaces an existing alias in place", () => {
    const c = setRoute(base(), { alias: "smart", target: ["an"], model: "claude-3" });
    const chain = reval(c).resolve("smart");
    expect(chain.map((r) => r.provider.id)).toEqual(["an"]);
  });

  it("setRoute rejects an unknown target provider", () => {
    expect(() => setRoute(base(), { alias: "x", target: ["ghost"] })).toThrow(/unknown provider/);
  });

  it("removeRoute drops an alias", () => {
    const c = removeRoute(base(), "smart");
    expect(reval(c).resolve("smart")).toEqual([]);
    expect(() => removeRoute(base(), "ghost")).toThrow(/not found/);
  });
});

describe("combos — strategy + round-robin", () => {
  it("a combo defaults to fallback (config order preserved)", () => {
    const cfg = reval(setRoute(base(), { alias: "smart", target: ["oa", "an"], model: "m" }));
    expect(cfg.listRoutes().find((r) => r.alias === "smart")!.strategy).toBe("fallback");
    expect(cfg.resolve("smart").map((r) => r.provider.id)).toEqual(["oa", "an"]);
  });

  it("setRoute persists a round-robin strategy", () => {
    const cfg = reval(setRoute(base(), { alias: "smart", target: ["oa", "an"], model: "m", strategy: "round-robin" }));
    expect(cfg.listRoutes().find((r) => r.alias === "smart")!.strategy).toBe("round-robin");
  });

  it("round-robin rotates the first target tried per request", () => {
    const cfg = reval(setRoute(base(), { alias: "smart", target: ["oa", "an"], model: "m", strategy: "round-robin" }));
    // each resolve rotates the chain so load spreads across the two providers
    expect(cfg.resolve("smart").map((r) => r.provider.id)).toEqual(["oa", "an"]);
    expect(cfg.resolve("smart").map((r) => r.provider.id)).toEqual(["an", "oa"]);
    expect(cfg.resolve("smart").map((r) => r.provider.id)).toEqual(["oa", "an"]);
  });

  it("fallback never rotates", () => {
    const cfg = reval(setRoute(base(), { alias: "smart", target: ["oa", "an"], model: "m" }));
    expect(cfg.resolve("smart").map((r) => r.provider.id)).toEqual(["oa", "an"]);
    expect(cfg.resolve("smart").map((r) => r.provider.id)).toEqual(["oa", "an"]);
  });
});

describe("endpoint toggles + gateway keys", () => {
  it("setRtk / setCaveman / setPonytail flip endpoint settings", () => {
    let c = setRtk(base(), true);
    c = setCaveman(c, "full");
    c = setPonytail(c, "lite");
    const cfg = reval(c);
    expect(cfg.endpoint.rtk).toBe(true);
    expect(cfg.endpoint.caveman).toBe("full");
    expect(cfg.endpoint.ponytail).toBe("lite");
  });

  it("addServerKey appends, rejects duplicates; removeServerKey drops by index", () => {
    let c = addServerKey(base(), "gw-2");
    expect(reval(c).server.api_keys).toEqual(["gw-1", "gw-2"]);
    expect(() => addServerKey(c, "gw-1")).toThrow(/already present/);
    c = removeServerKey(c, 0);
    expect(reval(c).server.api_keys).toEqual(["gw-2"]);
    expect(() => removeServerKey(c, 9)).toThrow(/no gateway key/);
  });

  it("addServerKey stores an optional name; removeServerKey clears it", () => {
    let c = addServerKey(base(), "gw-2", "Claude Code");
    expect(reval(c).server.key_names).toEqual({ "gw-2": "Claude Code" });
    c = removeServerKey(c, 1); // drops gw-2, and its label with it
    expect(reval(c).server.key_names ?? {}).toEqual({});
  });
});

describe("mutations preserve maskability (secrets still real after mutate)", () => {
  it("a key added stays a real, maskable value", () => {
    const c = addProviderKey(base(), "oa", "sk-brand-new-123456");
    const real = reval(c).getProvider("oa")!.api_keys!.at(-1)!;
    expect(real).toBe("sk-brand-new-123456");
    expect(maskKey(real)).toBe("sk-bran…3456");
  });
});

describe("renameProvider", () => {
  it("renames the id and repoints combos that target it", () => {
    const c = renameProvider(base(), "oa", "openai-x");
    expect(reval(c).getProvider("openai-x")).toBeDefined();
    expect(reval(c).getProvider("oa")).toBeUndefined();
    // the "smart" combo targeted ["oa","an"] → ["openai-x","an"]
    expect(reval(c).listRoutes().find((r) => r.alias === "smart")!.target).toEqual(["openai-x", "an"]);
  });

  it("rejects a duplicate id, a blank id, or spaces/slashes", () => {
    expect(() => renameProvider(base(), "oa", "an")).toThrow(/already exists/);
    expect(() => renameProvider(base(), "oa", "  ")).toThrow(/must not be empty/);
    expect(() => renameProvider(base(), "oa", "a b")).toThrow(/spaces or/);
    expect(() => renameProvider(base(), "oa", "a/b")).toThrow(/spaces or/);
  });

  it("renaming to the same id is a no-op", () => {
    expect(reval(renameProvider(base(), "oa", "oa")).getProvider("oa")).toBeDefined();
  });
});

describe("editServerKey", () => {
  it("sets and clears a gateway key label", () => {
    const named = editServerKey(base(), 0, { name: "Claude Code" });
    expect(named.server.key_names?.["gw-1"]).toBe("Claude Code");
    const cleared = editServerKey(named, 0, { name: "" });
    expect(cleared.server.key_names).toBeUndefined();
  });

  it("rejects an out-of-range index", () => {
    expect(() => editServerKey(base(), 9, { name: "x" })).toThrow(/no gateway key/);
  });
});

// ---- scoped budget mutations ------------------------------------------------

function cfgWithProvider(): Config {
  return validateConfig({
    providers: [{ id: "openai", format: "openai", base_url: "https://x.test", api_key: "k" }],
    models: [],
  }).raw;
}

describe("budgetKey", () => {
  it("encodes each scope type", () => {
    expect(budgetKey({ type: "global" })).toBe("global");
    expect(budgetKey({ type: "provider", id: "openai" })).toBe("provider:openai");
    expect(budgetKey({ type: "model", id: "claude-opus-4-6" })).toBe("model:claude-opus-4-6");
  });
});

describe("scoped budget mutations", () => {
  it("setBudget adds a global budget", () => {
    const next = setBudget(cfgWithProvider(), {
      scope: { type: "global" }, unit: "usd", limit: 50, window: "30day",
    });
    expect(next.budgets).toHaveLength(1);
    expect(next.budgets[0]!.scope).toEqual({ type: "global" });
  });

  it("setBudget replaces a budget with the same scope key", () => {
    const a = setBudget(cfgWithProvider(), { scope: { type: "global" }, unit: "usd", limit: 50, window: "30day" });
    const b = setBudget(a, { scope: { type: "global" }, unit: "tokens", limit: 1000, window: "24h" });
    expect(b.budgets).toHaveLength(1);
    expect(b.budgets[0]!.unit).toBe("tokens");
  });

  it("setBudget keeps budgets with different scopes side by side", () => {
    const a = setBudget(cfgWithProvider(), { scope: { type: "global" }, unit: "usd", limit: 50, window: "30day" });
    const b = setBudget(a, { scope: { type: "provider", id: "openai" }, unit: "usd", limit: 20, window: "30day" });
    expect(b.budgets).toHaveLength(2);
  });

  it("setBudget rejects a provider scope for an unknown provider", () => {
    expect(() =>
      setBudget(cfgWithProvider(), { scope: { type: "provider", id: "nope" }, unit: "usd", limit: 20, window: "30day" }),
    ).toThrow(/unknown provider/);
  });

  it("clearBudget removes by scope key", () => {
    const a = setBudget(cfgWithProvider(), { scope: { type: "provider", id: "openai" }, unit: "usd", limit: 20, window: "30day" });
    const b = clearBudget(a, "provider:openai");
    expect(b.budgets).toHaveLength(0);
  });

  it("schema rejects an invalid scope type", () => {
    expect(() => validateConfig({ providers: [], models: [], budgets: [{ scope: { type: "team" }, unit: "usd", limit: 5, window: "daily" }] }))
      .toThrow(/invalid config/);
  });

  it("migrates a legacy single budget to a global-scoped entry", () => {
    const cfg = validateConfig({ providers: [], models: [], budget: { unit: "usd", limit: 50, window: "monthly" } });
    expect(cfg.raw.budgets).toHaveLength(1);
    expect(cfg.raw.budgets[0]!.scope).toEqual({ type: "global" });
    expect(cfg.raw.budgets[0]!.limit).toBe(50);
    expect((cfg.raw as Record<string, unknown>).budget).toBeUndefined();
  });

  it("setBudget stamps the anchor at creation time", () => {
    const next = setBudget(
      cfgWithProvider(),
      { scope: { type: "global" }, unit: "usd", limit: 50, window: "30day" },
      1234,
    );
    expect(next.budgets[0]!.anchor).toBe(1234);
  });

  it("setBudget keeps the anchor on replace when the window is unchanged", () => {
    const a = setBudget(cfgWithProvider(), { scope: { type: "global" }, unit: "usd", limit: 50, window: "30day" }, 1000);
    const b = setBudget(a, { scope: { type: "global" }, unit: "usd", limit: 80, window: "30day" }, 9999);
    expect(b.budgets[0]!.anchor).toBe(1000);
    expect(b.budgets[0]!.limit).toBe(80);
  });

  it("setBudget resets the anchor on replace when the window length changes", () => {
    const a = setBudget(cfgWithProvider(), { scope: { type: "global" }, unit: "usd", limit: 50, window: "30day" }, 1000);
    const b = setBudget(a, { scope: { type: "global" }, unit: "usd", limit: 50, window: "7day" }, 9999);
    expect(b.budgets[0]!.anchor).toBe(9999);
  });

  it("editing a legacy budget (no anchor) keeps it anchorless when the window is unchanged", () => {
    // simulate a budget from before the anchor feature: no anchor stored.
    const legacy = validateConfig({
      providers: [], models: [],
      budgets: [{ scope: { type: "global" }, unit: "usd", limit: 50, window: "30day" }],
    }).raw;
    expect(legacy.budgets[0]!.anchor).toBeUndefined();
    // edit only the limit — must NOT stamp an anchor (that would reset spend).
    const edited = setBudget(legacy, { scope: { type: "global" }, unit: "usd", limit: 80, window: "30day" }, 9999);
    expect(edited.budgets[0]!.anchor).toBeUndefined();
    expect(edited.budgets[0]!.limit).toBe(80);
  });
});

// ---- key-scoped budgets -----------------------------------------------------

function cfgWithKey(): Config {
  return validateConfig({
    server: { api_keys: ["device-A-key"] },
    providers: [], models: [],
  }).raw;
}

describe("key-scoped budgets", () => {
  it("budgetKey encodes a key scope", () => {
    expect(budgetKey({ type: "key", id: "abcd1234" })).toBe("key:abcd1234");
  });
  it("setBudget accepts a key scope whose fingerprint matches a server key", () => {
    const fp = clientKeyFingerprint("device-A-key");
    const next = setBudget(cfgWithKey(), { scope: { type: "key", id: fp }, unit: "usd", limit: 5, window: "30day" });
    expect(next.budgets[0]!.scope).toEqual({ type: "key", id: fp });
  });
  it("setBudget rejects a key scope for an unknown fingerprint", () => {
    expect(() =>
      setBudget(cfgWithKey(), { scope: { type: "key", id: "deadbeef" }, unit: "usd", limit: 5, window: "30day" }),
    ).toThrow(/unknown API key/);
  });
  it("schema rejects a key scope with an empty id", () => {
    expect(() => validateConfig({ providers: [], models: [], budgets: [{ scope: { type: "key", id: "" }, unit: "usd", limit: 5, window: "daily" }] }))
      .toThrow(/invalid config/);
  });
});

// ---- removeServerKey cleans up per-key scope entries -----------------------

describe("removeServerKey cleans up key_models + key_rpm", () => {
  function cfgWithTwoKeys(): Config {
    return validateConfig({
      server: { host: "127.0.0.1", port: 18080, api_keys: ["sk-a", "sk-b"] },
      providers: [],
      models: [],
    }).raw;
  }

  it("drops the removed key's allowlist and rpm entries, prunes empty maps", () => {
    // set scopes on key 0 ("sk-a") only
    let c = setServerKeyScope(cfgWithTwoKeys(), 0, { models: ["gpt-4o"], rpm: 30 });
    expect(c.server.key_models).toEqual({ "sk-a": ["gpt-4o"] });
    expect(c.server.key_rpm).toEqual({ "sk-a": 30 });

    // remove key 0 — scopes must vanish and maps must be pruned to undefined
    c = removeServerKey(c, 0);
    expect(c.server.api_keys).toEqual(["sk-b"]);
    expect(c.server.key_models).toBeUndefined();
    expect(c.server.key_rpm).toBeUndefined();
  });

  it("keeps other keys' scope entries when one key is removed", () => {
    let c = setServerKeyScope(cfgWithTwoKeys(), 0, { models: ["gpt-4o"], rpm: 30 });
    c = setServerKeyScope(c, 1, { models: ["claude-sonnet-4-6"], rpm: 60 });

    // remove key 0 ("sk-a") — key 1 ("sk-b") scopes must survive
    c = removeServerKey(c, 0);
    expect(c.server.api_keys).toEqual(["sk-b"]);
    expect(c.server.key_models).toEqual({ "sk-b": ["claude-sonnet-4-6"] });
    expect(c.server.key_rpm).toEqual({ "sk-b": 60 });
  });
});

// ---- per-key scopes (model allowlist + rpm) ---------------------------------

describe("setServerKeyScope", () => {
  // helper: build a minimal config with two server keys
  function cfgWithKeys(): Config {
    return validateConfig({
      server: { host: "127.0.0.1", port: 18080, api_keys: ["sk-a", "sk-b"] },
      providers: [],
      models: [],
    }).raw;
  }

  it("sets the model allowlist + rpm for the key at an index", () => {
    const c = setServerKeyScope(cfgWithKeys(), 0, { models: ["claude-sonnet-4-6", "openai/gpt-4o"], rpm: 60 });
    expect(c.server.key_models).toEqual({ "sk-a": ["claude-sonnet-4-6", "openai/gpt-4o"] });
    expect(c.server.key_rpm).toEqual({ "sk-a": 60 });
  });

  it("clears the allowlist with an empty list and rpm with null, pruning empty maps", () => {
    let c = setServerKeyScope(cfgWithKeys(), 0, { models: ["x"], rpm: 30 });
    c = setServerKeyScope(c, 0, { models: [], rpm: null });
    expect(c.server.key_models).toBeUndefined();
    expect(c.server.key_rpm).toBeUndefined();
  });

  it("throws for an out-of-range index", () => {
    expect(() => setServerKeyScope(cfgWithKeys(), 5, { rpm: 10 })).toThrow();
  });

  it("masks key_models and key_rpm keys via maskKey (raw keys never leak)", () => {
    const c = setServerKeyScope(cfgWithKeys(), 0, { models: ["m"], rpm: 9 });
    // raw key "sk-a" must be present in the real config
    expect(c.server.key_models!["sk-a"]).toEqual(["m"]);
    expect(c.server.key_rpm!["sk-a"]).toBe(9);
    // the masked form must NOT be a key in the raw config (masking happens in admin)
    const masked = maskKey("sk-a");
    expect(masked).not.toBe("sk-a");
    // verify maskKey transforms the key as expected (so admin.ts re-keying works)
    expect(masked).toContain("…");
  });
});

// ---- per-key expiry (expired_at) -------------------------------------------

describe("per-key expiry", () => {
  it("setServerKeyScope stores an expiry for the key", () => {
    const next = setServerKeyScope(cfgWithKey(), 0, { expires: 2_000 });
    expect(next.server.key_expires?.["device-A-key"]).toBe(2_000);
  });

  it("setServerKeyScope clears the expiry when passed null", () => {
    const a = setServerKeyScope(cfgWithKey(), 0, { expires: 2_000 });
    const b = setServerKeyScope(a, 0, { expires: null });
    expect(b.server.key_expires).toBeUndefined();
  });

  it("setServerKeyScope leaves expiry untouched when the field is absent", () => {
    const a = setServerKeyScope(cfgWithKey(), 0, { expires: 2_000 });
    const b = setServerKeyScope(a, 0, { rpm: 60 }); // editing rpm only
    expect(b.server.key_expires?.["device-A-key"]).toBe(2_000);
  });

  it("removeServerKey drops the expiry entry", () => {
    const a = setServerKeyScope(cfgWithKey(), 0, { expires: 2_000 });
    const b = removeServerKey(a, 0);
    expect(b.server.key_expires).toBeUndefined();
  });

  it("isKeyExpired: true only when now is past a set expiry", () => {
    const cfg = setServerKeyScope(cfgWithKey(), 0, { expires: 1_000 });
    expect(isKeyExpired(cfg.server, "device-A-key", 999)).toBe(false);
    expect(isKeyExpired(cfg.server, "device-A-key", 1_000)).toBe(false); // exactly at expiry = still valid
    expect(isKeyExpired(cfg.server, "device-A-key", 1_001)).toBe(true);
  });

  it("isKeyExpired: false for a key with no expiry set", () => {
    expect(isKeyExpired(cfgWithKey().server, "device-A-key", 9_999_999)).toBe(false);
  });
});
