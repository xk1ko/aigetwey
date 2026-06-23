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
  renameProvider,
  maskKey,
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
    expect(p.cooldown_base_ms).toBe(1000);
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
    expect(() => removeProvider(base(), "oa")).toThrow(/targeted by model alias/);
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
    expect(maskKey(real)).toBe("sk-…3456");
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
