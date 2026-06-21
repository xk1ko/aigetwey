import {
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

// ---- schema (PLAN §8) -------------------------------------------------------
//
// Shape differs from a flat OpenAI gateway: routing lives in a top-level
// `models[]` layer (alias -> provider chain), the endpoint block carries the
// token-saver toggles, and providers may be free passthroughs or service-account
// backed. The handler/keypool/quota phases read these fields; defining the full
// shape up front avoids reshaping config across later phases.

/** Token quota window for a provider — drives the dashboard reset countdown. */
const QuotaSchema = z.object({
  window: z.enum(["5h", "daily", "weekly", "monthly"]),
  // daily: "HH:MM" local reset; weekly: weekday name ("monday"); others: ignored.
  reset_at: z.string().optional(),
  timezone: z.string().default("UTC"),
  // optional ceiling for a progress bar; quota tracking works without it.
  limit_tokens: z.number().int().positive().optional(),
});

const ProviderModelSchema = z.object({
  id: z.string().min(1),
  price_in: z.number().nonnegative().optional(),
  price_out: z.number().nonnegative().optional(),
});

const ProviderSchema = z
  .object({
    id: z.string().min(1),
    format: z.enum(["openai", "anthropic", "gemini"]),
    base_url: z.string().url(),
    api_key: z.string().min(1).optional(),
    api_keys: z.array(z.string().min(1)).optional(),
    // free passthrough (OpenCode Free): no upstream auth required.
    free: z.boolean().default(false),
    // fetch the provider's model catalog at runtime instead of from config.
    auto_models: z.boolean().default(false),
    // path to a GCP service-account JSON (Vertex AI): JWT-exchanged for tokens.
    service_account: z.string().optional(),
    models: z.array(ProviderModelSchema).default([]),
    headers: z.record(z.string()).optional(),
    quota: QuotaSchema.optional(),
    // base cooldown after a retryable key failure, doubled per consecutive fail.
    cooldown_base_ms: z.number().int().positive().default(1000),
    // keys to try within this provider before falling through to the next.
    max_retries: z.number().int().nonnegative().default(2),
  })
  .refine((p) => p.free || p.service_account || p.api_key || (p.api_keys?.length ?? 0) > 0, {
    message: "provider needs api_key/api_keys, or free: true, or service_account",
  });

/**
 * Routing entry: a client-facing `alias` resolved to a prioritized chain of
 * providers. `model[i]` pairs with `target[i]`; a single string applies to all
 * targets; omitted falls back to the alias name as the upstream model id.
 */
const ModelRouteSchema = z.object({
  alias: z.string().min(1),
  target: z.array(z.string().min(1)).min(1),
  model: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  price_in: z.number().nonnegative().optional(),
  price_out: z.number().nonnegative().optional(),
});

/** A named snapshot of the routing layer; `active` marks the live preset. */
const ComboSchema = z.object({
  name: z.string().min(1),
  active: z.boolean().default(false),
  models: z.array(ModelRouteSchema).default([]),
});

const EndpointSchema = z
  .object({
    rtk: z.boolean().default(false),
    caveman: z.enum(["off", "lite", "full", "ultra"]).default("off"),
    ponytail: z.enum(["off", "lite", "full", "ultra"]).default("off"),
  })
  .default({ rtk: false, caveman: "off", ponytail: "off" });

const ServerSchema = z
  .object({
    host: z.string().default("127.0.0.1"),
    port: z.number().int().positive().default(18080),
    // gateway-level keys clients must present. Empty => auth disabled (localhost).
    api_keys: z.array(z.string().min(1)).default([]),
  })
  .default({ host: "127.0.0.1", port: 18080, api_keys: [] });

const ConfigSchema = z.object({
  server: ServerSchema,
  endpoint: EndpointSchema,
  providers: z.array(ProviderSchema).default([]),
  models: z.array(ModelRouteSchema).default([]),
  combos: z.array(ComboSchema).default([]),
});

export type Quota = z.infer<typeof QuotaSchema>;
export type ProviderModel = z.infer<typeof ProviderModelSchema>;
export type Provider = z.infer<typeof ProviderSchema>;
export type ModelRoute = z.infer<typeof ModelRouteSchema>;
export type Combo = z.infer<typeof ComboSchema>;
export type EndpointSettings = z.infer<typeof EndpointSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export interface ResolvedRoute {
  /** client-facing alias that resolved to this route */
  alias: string;
  provider: Provider;
  /** upstream model id to send */
  model: string;
  price_in?: number;
  price_out?: number;
}

export class GatewayConfig {
  readonly server: Config["server"];
  readonly endpoint: Config["endpoint"];
  readonly raw: Config;
  private readonly providers: Map<string, Provider>;
  private readonly routes: Map<string, ModelRoute>;

  constructor(raw: Config) {
    this.raw = raw;
    this.server = raw.server;
    this.endpoint = raw.endpoint;
    this.providers = new Map(raw.providers.map((p) => [p.id, p]));
    this.routes = new Map(raw.models.map((m) => [m.alias, m]));

    // fail fast: a routing alias must only target known providers, else the
    // first request to that alias 404s at runtime with a confusing message.
    for (const m of raw.models) {
      for (const t of m.target) {
        if (!this.providers.has(t)) {
          throw new Error(`model alias "${m.alias}" targets unknown provider "${t}"`);
        }
      }
    }
  }

  /** Upstream model id for the i-th target of a route (see ModelRouteSchema). */
  private modelFor(route: ModelRoute, index: number): string {
    if (Array.isArray(route.model)) return route.model[index] ?? route.model[0] ?? route.alias;
    if (typeof route.model === "string") return route.model;
    return route.alias;
  }

  /**
   * Resolve a client model string to a prioritized chain of routes.
   *   - a routing alias => its target chain (fallback order).
   *   - "provider/model" => single direct route to that provider.
   * Returns [] when nothing matches (handler turns that into a 404).
   */
  resolve(name: string): ResolvedRoute[] {
    const route = this.routes.get(name);
    if (route) {
      return route.target.flatMap((providerId, i) => {
        const provider = this.providers.get(providerId);
        if (!provider) return [];
        return [
          {
            alias: name,
            provider,
            model: this.modelFor(route, i),
            price_in: route.price_in,
            price_out: route.price_out,
          },
        ];
      });
    }

    const slash = name.indexOf("/");
    if (slash > 0) {
      const providerId = name.slice(0, slash);
      const model = name.slice(slash + 1);
      const provider = this.providers.get(providerId);
      if (provider && model) {
        const entry = provider.models.find((m) => m.id === model);
        return [
          {
            alias: name,
            provider,
            model,
            price_in: entry?.price_in,
            price_out: entry?.price_out,
          },
        ];
      }
    }

    return [];
  }

  getProvider(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  listProviders(): Provider[] {
    return [...this.providers.values()];
  }

  listRoutes(): ModelRoute[] {
    return [...this.routes.values()];
  }

  listCombos(): Combo[] {
    return this.raw.combos;
  }
}

/** Validate an already-parsed config object. Throws with readable issues. */
export function validateConfig(parsed: unknown): GatewayConfig {
  const result = ConfigSchema.safeParse(parsed ?? {});
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`invalid config:\n${issues}`);
  }
  return new GatewayConfig(result.data);
}

export function loadConfig(path: string): GatewayConfig {
  const text = readFileSync(path, "utf8");
  try {
    return validateConfig(parseYaml(text));
  } catch (e) {
    throw new Error(`config at ${path}: ${(e as Error).message}`);
  }
}

/** Parse YAML or JSON text into a validated config (yaml parser accepts JSON). */
export function parseConfigText(text: string): GatewayConfig {
  return validateConfig(parseYaml(text));
}

export function serializeConfig(config: Config): string {
  return stringifyYaml(config);
}

/**
 * Mask a secret for display: keep a short suffix, hide the rest.
 * "" -> "(none)". "sk-abcdEFGHijklMNOP" -> "sk-…MNOP".
 */
export function maskKey(key: string): string {
  if (!key) return "(none)";
  if (key.length <= 8) return "…" + key.slice(-2);
  return key.slice(0, 3) + "…" + key.slice(-4);
}

function looksMasked(v: string): boolean {
  return v.includes("…");
}

/**
 * Resolve masked secrets in an edited config back to real values.
 *
 * The dashboard shows keys masked. On save, unchanged keys return still masked;
 * writing those verbatim would corrupt config. Map each masked value back to the
 * real key from the CURRENT config. A freshly-typed (unmasked) value is kept. An
 * unresolvable or ambiguous mask throws — better to refuse than write a wrong
 * secret. Mutates and returns `next`.
 */
export function unmaskSecrets(next: Config, current: Config): Config {
  const byMask = new Map<string, string | null>(); // mask -> real, or null if ambiguous
  const note = (real: string) => {
    if (!real) return;
    const m = maskKey(real);
    if (byMask.has(m) && byMask.get(m) !== real) byMask.set(m, null);
    else byMask.set(m, real);
  };
  for (const p of current.providers) {
    if (p.api_key) note(p.api_key);
    p.api_keys?.forEach(note);
  }
  current.server.api_keys.forEach(note);

  const resolve = (v: string): string => {
    if (!looksMasked(v)) return v;
    const real = byMask.get(v);
    if (real === undefined) throw new Error(`cannot resolve masked key "${v}" — type the real key`);
    if (real === null) throw new Error(`masked key "${v}" is ambiguous — type the real key`);
    return real;
  };

  for (const p of next.providers) {
    if (p.api_key) p.api_key = resolve(p.api_key);
    if (p.api_keys) p.api_keys = p.api_keys.map(resolve);
  }
  next.server.api_keys = next.server.api_keys.map(resolve);
  return next;
}

/**
 * Write config to disk atomically with a one-level backup. Backs up the existing
 * file to <path>.bak, writes a temp file, then renames over the target so a crash
 * mid-write can't leave a corrupt config.
 */
export function writeConfigFile(path: string, config: Config): void {
  const yaml = serializeConfig(config);
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) copyFileSync(path, path + ".bak");
  const tmp = path + ".tmp";
  writeFileSync(tmp, yaml, "utf8");
  renameSync(tmp, path);
}

// ---- granular config mutations (admin write surface) -----------------------
//
// Each returns a NEW Config (clone + mutate); the caller serializes it and feeds
// it through state.reload(), which re-validates (zod) and persists atomically.
// So url/length checks and schema defaults are enforced there — these helpers
// own only the structural change and the guards zod can't express.

function cloneConfig(config: Config): Config {
  return JSON.parse(JSON.stringify(config)) as Config;
}

/** Real keys a provider routes through, in the order the keypool sees them. */
function realKeysOf(p: Provider): string[] {
  if (p.api_keys && p.api_keys.length > 0) return p.api_keys;
  if (p.api_key) return [p.api_key];
  return [];
}

export function addProvider(
  config: Config,
  input: {
    id: string;
    format: Provider["format"];
    base_url: string;
    api_key?: string;
    free?: boolean;
    auto_models?: boolean;
    service_account?: string;
  },
): Config {
  const next = cloneConfig(config);
  if (next.providers.some((p) => p.id === input.id)) {
    throw new Error(`provider "${input.id}" already exists`);
  }
  next.providers.push({
    id: input.id,
    format: input.format,
    base_url: input.base_url,
    free: input.free ?? false,
    auto_models: input.auto_models ?? false,
    models: [],
    cooldown_base_ms: 1000,
    max_retries: 2,
    ...(input.api_key ? { api_keys: [input.api_key] } : {}),
    ...(input.service_account ? { service_account: input.service_account } : {}),
  });
  return next;
}

/** Edit a provider's base_url and/or format (id is immutable). */
export function editProvider(
  config: Config,
  id: string,
  patch: { base_url?: string; format?: Provider["format"] },
): Config {
  const next = cloneConfig(config);
  const p = next.providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider "${id}" not found`);
  if (patch.base_url !== undefined) {
    if (!patch.base_url.trim()) throw new Error("base_url must not be empty");
    p.base_url = patch.base_url.trim();
  }
  if (patch.format !== undefined) p.format = patch.format;
  return next;
}

/** Remove a provider; refuses if any routing alias still targets it. */
export function removeProvider(config: Config, id: string): Config {
  const next = cloneConfig(config);
  const idx = next.providers.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`provider "${id}" not found`);
  const usedBy = next.models.filter((m) => m.target.includes(id)).map((m) => m.alias);
  if (usedBy.length > 0) {
    throw new Error(`provider "${id}" is targeted by model alias(es): ${usedBy.join(", ")} — edit those first`);
  }
  next.providers.splice(idx, 1);
  return next;
}

export function addProviderKey(config: Config, id: string, key: string): Config {
  const next = cloneConfig(config);
  const p = next.providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider "${id}" not found`);
  if (!key.trim()) throw new Error("key must not be empty");
  p.api_keys = [...realKeysOf(p), key];
  delete p.api_key;
  return next;
}

export function removeProviderKey(config: Config, id: string, index: number): Config {
  const next = cloneConfig(config);
  const p = next.providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider "${id}" not found`);
  const keys = realKeysOf(p);
  if (index < 0 || index >= keys.length) throw new Error(`no key at index ${index} for provider "${id}"`);
  // free/service-account providers may legitimately hold zero keys; a keyed
  // provider keeps at least one (remove the provider instead to fully drop it).
  if (keys.length <= 1 && !p.free && !p.service_account) {
    throw new Error(`cannot remove the last key of "${id}" — delete the provider instead`);
  }
  keys.splice(index, 1);
  p.api_keys = keys;
  delete p.api_key;
  return next;
}

export function addProviderModel(
  config: Config,
  id: string,
  model: string,
  price?: { price_in?: number; price_out?: number },
): Config {
  const trimmed = model.trim();
  if (!trimmed) throw new Error("model id must not be empty");
  const next = cloneConfig(config);
  const p = next.providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider "${id}" not found`);
  if (p.models.some((m) => m.id === trimmed)) {
    throw new Error(`provider "${id}" already serves model "${trimmed}"`);
  }
  p.models.push({
    id: trimmed,
    ...(price?.price_in !== undefined ? { price_in: price.price_in } : {}),
    ...(price?.price_out !== undefined ? { price_out: price.price_out } : {}),
  });
  return next;
}

export function removeProviderModel(config: Config, id: string, model: string): Config {
  const next = cloneConfig(config);
  const p = next.providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider "${id}" not found`);
  const idx = p.models.findIndex((m) => m.id === model);
  if (idx === -1) throw new Error(`provider "${id}" does not serve model "${model}"`);
  p.models.splice(idx, 1);
  return next;
}

// ---- routing layer: client alias -> prioritized provider chain -------------

/** Create or replace a routing alias. target[] is the fallback order. */
export function setRoute(
  config: Config,
  route: { alias: string; target: string[]; model?: string | string[]; price_in?: number; price_out?: number },
): Config {
  const alias = route.alias.trim();
  if (!alias) throw new Error("alias must not be empty");
  if (!route.target.length) throw new Error("a route needs at least one target provider");
  const next = cloneConfig(config);
  for (const t of route.target) {
    if (!next.providers.some((p) => p.id === t)) throw new Error(`unknown provider "${t}" in route`);
  }
  const entry: ModelRoute = {
    alias,
    target: route.target,
    ...(route.model !== undefined ? { model: route.model } : {}),
    ...(route.price_in !== undefined ? { price_in: route.price_in } : {}),
    ...(route.price_out !== undefined ? { price_out: route.price_out } : {}),
  };
  const idx = next.models.findIndex((m) => m.alias === alias);
  if (idx === -1) next.models.push(entry);
  else next.models[idx] = entry;
  return next;
}

export function removeRoute(config: Config, alias: string): Config {
  const next = cloneConfig(config);
  const idx = next.models.findIndex((m) => m.alias === alias);
  if (idx === -1) throw new Error(`route "${alias}" not found`);
  next.models.splice(idx, 1);
  return next;
}

// ---- combos: named snapshots of the routing layer --------------------------
//
// A combo captures the current `models[]` under a name. Activating one swaps its
// snapshot back into `models[]` (the live routing) and flags it active; only one
// combo is active at a time.

/** Save the current routing table as a named combo. */
export function createCombo(config: Config, name: string): Config {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("combo name must not be empty");
  const next = cloneConfig(config);
  if (next.combos.some((c) => c.name === trimmed)) throw new Error(`combo "${trimmed}" already exists`);
  next.combos.push({ name: trimmed, active: false, models: JSON.parse(JSON.stringify(next.models)) });
  return next;
}

/** Swap a combo's snapshot into the live routing table and mark it active. */
export function activateCombo(config: Config, name: string): Config {
  const next = cloneConfig(config);
  const combo = next.combos.find((c) => c.name === name);
  if (!combo) throw new Error(`combo "${name}" not found`);
  next.models = JSON.parse(JSON.stringify(combo.models));
  for (const c of next.combos) c.active = c.name === name;
  return next;
}

export function deleteCombo(config: Config, name: string): Config {
  const next = cloneConfig(config);
  const idx = next.combos.findIndex((c) => c.name === name);
  if (idx === -1) throw new Error(`combo "${name}" not found`);
  next.combos.splice(idx, 1);
  return next;
}

export function renameCombo(config: Config, name: string, newName: string): Config {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error("new combo name must not be empty");
  const next = cloneConfig(config);
  const combo = next.combos.find((c) => c.name === name);
  if (!combo) throw new Error(`combo "${name}" not found`);
  if (trimmed !== name && next.combos.some((c) => c.name === trimmed)) {
    throw new Error(`combo "${trimmed}" already exists`);
  }
  combo.name = trimmed;
  return next;
}

export function copyCombo(config: Config, name: string, newName: string): Config {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error("new combo name must not be empty");
  const next = cloneConfig(config);
  const src = next.combos.find((c) => c.name === name);
  if (!src) throw new Error(`combo "${name}" not found`);
  if (next.combos.some((c) => c.name === trimmed)) throw new Error(`combo "${trimmed}" already exists`);
  next.combos.push({ name: trimmed, active: false, models: JSON.parse(JSON.stringify(src.models)) });
  return next;
}

// ---- endpoint settings: token-saver toggles + gateway keys -----------------

export function setRtk(config: Config, enabled: boolean): Config {
  const next = cloneConfig(config);
  next.endpoint.rtk = enabled;
  return next;
}

export function setCaveman(config: Config, level: EndpointSettings["caveman"]): Config {
  const next = cloneConfig(config);
  next.endpoint.caveman = level;
  return next;
}

export function setPonytail(config: Config, level: EndpointSettings["ponytail"]): Config {
  const next = cloneConfig(config);
  next.endpoint.ponytail = level;
  return next;
}

/** Append a gateway-level api key clients must present on /v1/*. */
export function addServerKey(config: Config, key: string): Config {
  const trimmed = key.trim();
  if (!trimmed) throw new Error("key must not be empty");
  const next = cloneConfig(config);
  if (next.server.api_keys.includes(trimmed)) throw new Error("key already present");
  next.server.api_keys = [...next.server.api_keys, trimmed];
  return next;
}

/** Remove a gateway key by index (keys are masked in the API, so by-index). */
export function removeServerKey(config: Config, index: number): Config {
  const next = cloneConfig(config);
  if (index < 0 || index >= next.server.api_keys.length) throw new Error(`no gateway key at index ${index}`);
  next.server.api_keys.splice(index, 1);
  return next;
}
