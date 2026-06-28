import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateConfig,
  parseConfigText,
  maskKey,
  unmaskSecrets,
  writeConfigFile,
  type Config,
} from "../src/config.js";

const baseProvider = {
  id: "openai",
  format: "openai",
  base_url: "https://api.openai.com/v1",
  api_key: "sk-real-1234567890",
};

describe("validateConfig — defaults", () => {
  it("fills server/endpoint defaults from an empty object", () => {
    const c = validateConfig({});
    expect(c.server.port).toBe(18080);
    expect(c.server.host).toBe("0.0.0.0");
    expect(c.endpoint.rtk).toBe(false);
    expect(c.endpoint.caveman).toBe("off");
    expect(c.listProviders()).toHaveLength(0);
  });

  it("applies provider defaults (free flag)", () => {
    const c = validateConfig({ providers: [baseProvider] });
    const p = c.getProvider("openai")!;
    expect(p.free).toBe(false);
  });
});

describe("validateConfig — provider auth requirement", () => {
  it("rejects a provider with no key, free, or service_account", () => {
    expect(() =>
      validateConfig({
        providers: [{ id: "x", format: "openai", base_url: "https://x.test/v1" }],
      }),
    ).toThrow(/api_key|free|service_account/);
  });
  it("accepts a free provider with no key", () => {
    const c = validateConfig({
      providers: [{ id: "free", format: "openai", base_url: "https://x.test/v1", free: true }],
    });
    expect(c.getProvider("free")!.free).toBe(true);
  });
  it("accepts a service-account provider with no key", () => {
    const c = validateConfig({
      providers: [
        { id: "vertex", format: "gemini", base_url: "https://x.test/v1", service_account: "/sa.json" },
      ],
    });
    expect(c.getProvider("vertex")!.service_account).toBe("/sa.json");
  });
});

describe("validateConfig — routing integrity", () => {
  it("rejects a model alias targeting an unknown provider", () => {
    expect(() =>
      validateConfig({
        providers: [baseProvider],
        models: [{ alias: "a", target: ["ghost"] }],
      }),
    ).toThrow(/unknown provider "ghost"/);
  });
});

describe("GatewayConfig.resolve", () => {
  const cfg = validateConfig({
    providers: [
      baseProvider,
      { id: "anthropic", format: "anthropic", base_url: "https://api.anthropic.com/v1", api_key: "sk-ant-x" },
    ],
    models: [
      {
        alias: "smart",
        target: ["anthropic", "openai"],
        model: ["claude-sonnet-4-6", "gpt-4o"],
        price_in: 3,
        price_out: 15,
      },
      { alias: "same-model", target: ["openai", "anthropic"], model: "shared" },
    ],
  });

  it("resolves an alias to its ordered provider chain with per-target models", () => {
    const chain = cfg.resolve("smart");
    expect(chain.map((r) => r.provider.id)).toEqual(["anthropic", "openai"]);
    expect(chain.map((r) => r.model)).toEqual(["claude-sonnet-4-6", "gpt-4o"]);
    expect(chain[0]!.price_in).toBe(3);
  });

  it("applies a single model string to every target", () => {
    const chain = cfg.resolve("same-model");
    expect(chain.map((r) => r.model)).toEqual(["shared", "shared"]);
  });

  it("resolves a direct provider/model string", () => {
    const chain = cfg.resolve("openai/gpt-4o-mini");
    expect(chain).toHaveLength(1);
    expect(chain[0]!.provider.id).toBe("openai");
    expect(chain[0]!.model).toBe("gpt-4o-mini");
  });

  it("returns [] for an unknown name", () => {
    expect(cfg.resolve("nope")).toEqual([]);
  });

  it("auto-detects provider/model format from provider catalogs", () => {
    const c = validateConfig({
      providers: [
        { id: "p1", format: "openai", base_url: "https://a", api_key: "k1", models: [{ id: "shared-m" }] },
        {
          id: "p2",
          format: "openai",
          base_url: "https://b",
          api_key: "k2",
          models: [{ id: "shared-m" }, { id: "only-2", price_in: 1, price_out: 2 }],
        },
      ],
    });

    // provider/model syntax picks price from that provider's catalog
    const single = c.resolve("p2/only-2");
    expect(single).toHaveLength(1);
    expect(single[0]!.provider.id).toBe("p2");
    expect(single[0]!.price_in).toBe(1);

    // bare model without prefix => nothing (no auto-detect)
    expect(c.resolve("shared-m")).toEqual([]);
    expect(c.resolve("ghost")).toEqual([]);
  });
});

describe("maskKey", () => {
  it("masks long keys keeping head and tail", () => {
    expect(maskKey("sk-abcdEFGHijklMNOP")).toBe("sk-abcd…MNOP");
  });
  it("masks short keys", () => {
    expect(maskKey("abcd")).toBe("…abcd");
  });
  it("renders empty as (none)", () => {
    expect(maskKey("")).toBe("(none)");
  });
});

describe("unmaskSecrets", () => {
  it("restores an unchanged masked key from the live config", () => {
    const current = validateConfig({ providers: [baseProvider] }).raw;
    // dashboard returns the key still masked
    const edited: Config = JSON.parse(JSON.stringify(current));
    edited.providers[0]!.api_key = maskKey("sk-real-1234567890");
    const out = unmaskSecrets(edited, current);
    expect(out.providers[0]!.api_key).toBe("sk-real-1234567890");
  });

  it("keeps a freshly typed (unmasked) key as-is", () => {
    const current = validateConfig({ providers: [baseProvider] }).raw;
    const edited: Config = JSON.parse(JSON.stringify(current));
    edited.providers[0]!.api_key = "sk-brand-new-value";
    expect(unmaskSecrets(edited, current).providers[0]!.api_key).toBe("sk-brand-new-value");
  });

  it("throws on a masked value with no matching live key", () => {
    const current = validateConfig({ providers: [baseProvider] }).raw;
    const edited: Config = JSON.parse(JSON.stringify(current));
    edited.providers[0]!.api_key = "zz…9999";
    expect(() => unmaskSecrets(edited, current)).toThrow(/cannot resolve/);
  });
});

describe("writeConfigFile — atomic write + backup", () => {
  it("writes YAML and backs up an existing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "aigloo-cfg-"));
    const path = join(dir, "config.yaml");
    const c1 = validateConfig({ providers: [baseProvider] }).raw;

    writeConfigFile(path, c1);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(path + ".bak")).toBe(false); // nothing to back up yet

    // round-trips through the parser
    const reloaded = parseConfigText(readFileSync(path, "utf8"));
    expect(reloaded.getProvider("openai")!.base_url).toBe(baseProvider.base_url);

    // second write backs up the previous file
    writeConfigFile(path, validateConfig({ providers: [{ ...baseProvider, id: "two" }] }).raw);
    expect(existsSync(path + ".bak")).toBe(true);
  });

  it("rejects an invalid config text", () => {
    writeFileSync(join(tmpdir(), "ignore.yaml"), ""); // noop, keeps tmp import used
    expect(() => parseConfigText("providers:\n  - id: x")).toThrow(/invalid config/);
  });
});
