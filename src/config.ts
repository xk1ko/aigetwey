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
