import "server-only";
import { currentPassword } from "./session";

/**
 * Server-side proxy to the gateway admin API. Runs only in Next.js server
 * context (route handlers / server components) — injects the admin password as
 * a Bearer token so it never reaches the browser.
 *
 * Scoped to the admin surface the gateway exposes today (usage, logs, providers,
 * budgets, whole-config CRUD). Granular provider/combo mutation helpers are added
 * alongside the pages that drive them in phase 11.
 */
function gatewayUrl(): string {
  return (process.env.GATEWAY_URL ?? "http://127.0.0.1:18080").replace(/\/$/, "");
}

export interface GatewayResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<GatewayResult<T>> {
  let res: Response;
  try {
    res = await fetch(gatewayUrl() + path, {
      method,
      headers: {
        authorization: `Bearer ${await currentPassword()}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, status: 0, data: null, error: `gateway unreachable: ${(e as Error).message}` };
  }

  const text = await res.text();
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: string } | null)?.error ?? `gateway returned ${res.status}`;
    return { ok: false, status: res.status, data, error: err };
  }
  return { ok: true, status: res.status, data };
}

/** Verify a specific admin password against the gateway (used at login, before a
 * session cookie exists). */
export async function checkGatewayAuth(password: string): Promise<boolean> {
  try {
    const res = await fetch(gatewayUrl() + "/admin/providers", {
      headers: { authorization: `Bearer ${password}` },
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const gateway = {
  providers: () => call<{ providers: ProviderSnapshot[] }>("GET", "/admin/providers"),
  budgets: () => call<{ budgets: BudgetStatus[] }>("GET", "/admin/budgets"),
  models: () => call<ModelsPayload>("GET", "/admin/models"),
  logs: (limit = 100) => call<{ logs: UsageLog[] }>("GET", `/admin/logs?limit=${limit}`),
  usage: (since = 0) => call<UsageSummary>("GET", `/admin/usage?since=${since}`),
  usageSeries: (since: number, bucket: number) =>
    call<{ series: UsageSeriesPoint[] }>("GET", `/admin/usage/series?since=${since}&bucket=${bucket}`),
  config: () => call<MaskedConfig>("GET", "/admin/config"),
  putConfig: (text: string) => call<{ ok: boolean; config: MaskedConfig }>("PUT", "/admin/config", { text }),
  changePassword: (current: string, next: string) =>
    call<{ ok: boolean }>("PUT", "/admin/password", { current, next }),

  // ---- provider mutations (reply carries the fresh masked config) ----
  addProvider: (p: {
    id: string;
    name?: string;
    format: WireFormat;
    base_url: string;
    api_key?: string;
    free?: boolean;
    auto_models?: boolean;
    service_account?: string;
  }) => call<ConfigReply>("POST", "/admin/providers", p),
  editProvider: (id: string, patch: { base_url?: string; format?: WireFormat; name?: string }) =>
    call<ConfigReply>("PUT", `/admin/providers/${encodeURIComponent(id)}`, patch),
  removeProvider: (id: string) => call<ConfigReply>("DELETE", `/admin/providers/${encodeURIComponent(id)}`),
  addKey: (id: string, key: string) =>
    call<ConfigReply>("POST", `/admin/providers/${encodeURIComponent(id)}/keys`, { key }),
  removeKey: (id: string, index: number) =>
    call<ConfigReply>("DELETE", `/admin/providers/${encodeURIComponent(id)}/keys/${index}`),
  addProviderModel: (id: string, model: string, price?: { price_in?: number; price_out?: number }) =>
    call<ConfigReply>("POST", `/admin/providers/${encodeURIComponent(id)}/models`, { model, ...price }),
  addProviderModels: (id: string, models: string[]) =>
    call<ConfigReply>("POST", `/admin/providers/${encodeURIComponent(id)}/models`, { models }),
  removeProviderModel: (id: string, model: string) =>
    call<ConfigReply>("DELETE", `/admin/providers/${encodeURIComponent(id)}/models/${encodeURIComponent(model)}`),
  clearProviderModels: (id: string) =>
    call<ConfigReply>("DELETE", `/admin/providers/${encodeURIComponent(id)}/models`),
  testProvider: (id: string) => call<PingResult>("POST", `/admin/providers/${encodeURIComponent(id)}/test`),
  discoverModels: (id: string) =>
    call<{ ok: boolean; models: Array<{ id: string; added: boolean }> }>(
      "POST",
      `/admin/providers/${encodeURIComponent(id)}/connect`,
    ),

  // ---- combos: alias + ordered provider chain + strategy ----
  setRoute: (
    alias: string,
    body: { target: string[]; model?: string | string[]; strategy?: "fallback" | "round-robin"; sticky?: number; price_in?: number; price_out?: number },
  ) => call<ConfigReply>("PUT", `/admin/routes/${encodeURIComponent(alias)}`, body),
  removeRoute: (alias: string) => call<ConfigReply>("DELETE", `/admin/routes/${encodeURIComponent(alias)}`),

  // ---- endpoint: toggles + gateway keys ----
  endpoint: () => call<EndpointPayload>("GET", "/admin/endpoint"),
  setRtk: (enabled: boolean) => call<ConfigReply>("PUT", "/admin/endpoint/rtk", { enabled }),
  setCaveman: (level: InjectLevel) => call<ConfigReply>("PUT", "/admin/endpoint/caveman", { level }),
  setPonytail: (level: InjectLevel) => call<ConfigReply>("PUT", "/admin/endpoint/ponytail", { level }),
  addServerKey: (key: string) => call<ConfigReply>("POST", "/admin/endpoint/keys", { key }),
  removeServerKey: (index: number) => call<ConfigReply>("DELETE", `/admin/endpoint/keys/${index}`),
};

// ---- shapes mirrored from the gateway admin API ----

export type WireFormat = "openai" | "anthropic" | "gemini";
export type InjectLevel = "off" | "lite" | "full" | "ultra";

export interface ConfigReply {
  ok: boolean;
  config: MaskedConfig;
}

export interface ImportResult {
  added: string[];
  merged: { id: string; newKeys: number }[];
  skipped: { id: string; reason: string }[];
}

export interface MaskedRoute {
  alias: string;
  target: string[];
  model?: string | string[];
  strategy: "fallback" | "round-robin";
  sticky?: number;
  price_in?: number;
  price_out?: number;
}
export interface MaskedProvider {
  id: string;
  name?: string;
  format: WireFormat;
  base_url: string;
  api_key?: string;
  api_keys?: string[];
  /** optional friendly label per key, keyed by the MASKED key string. */
  key_names?: Record<string, string>;
  free: boolean;
  auto_models: boolean;
  service_account?: string;
  models: Array<{ id: string; price_in?: number; price_out?: number }>;
  cooldown_base_ms: number;
  max_retries: number;
  disabled_keys?: number[];
  disabled?: boolean;
  strategy?: "fallback" | "round-robin";
  sticky?: number;
}
export interface MaskedConfig {
  server: { host: string; port: number; api_keys: string[] };
  endpoint: { rtk: boolean; caveman: InjectLevel; ponytail: InjectLevel };
  providers: MaskedProvider[];
  models: MaskedRoute[];
}

export interface EndpointPayload {
  port: number;
  rtk: boolean;
  caveman: InjectLevel;
  ponytail: InjectLevel;
  headroom: { enabled: boolean; url: string; compress_user_messages: boolean };
  keys: Array<{ key: string; fingerprint: string; name?: string; models?: string[]; rpm?: number; expires?: number }>;
}

export interface KeyUsageRow {
  fingerprint: string;
  name: string;
  masked: string;
  expires?: number;
  spent: number;
  tokens: number;
  budget: {
    unit: "usd" | "tokens";
    limit: number;
    spent: number;
    pct: number;
    window: string;
    reset_in_ms: number;
    exhausted: boolean;
    alert: boolean;
  } | null;
}

export interface HeadroomStatusReply {
  installed: boolean;
  path: string | null;
  running: boolean;
  python: string | null;
  localUrl: boolean;
  canStart: boolean;
  url: string;
  managedPid: number | null;
  enabled: boolean;
  compress_user_messages: boolean;
}

export interface PingResult {
  reachable: boolean;
  status?: number;
  ok: boolean;
  error?: string;
}

export interface PricingModel {
  id: string;
  price_in: number | null;
  price_out: number | null;
  default_in: number | null;
  default_out: number | null;
}
export interface PricingPayload {
  providers: Array<{ id: string; models: PricingModel[] }>;
}

export interface ModelsPayload {
  providers: Array<{
    id: string;
    format: WireFormat;
    models: Array<{ id: string; ref: string; price_in?: number; price_out?: number }>;
  }>;
  routes: MaskedRoute[];
}

export interface KeySnapshot {
  key: string;
  healthy: boolean;
  cooldown_ms: number;
  fail_count: number;
  last_error: { message: string; status?: number; at: number } | null;
}
export interface ProviderSnapshot {
  id: string;
  format: WireFormat;
  keys: KeySnapshot[];
}
export type BudgetScope =
  | { type: "global" }
  | { type: "provider"; id: string }
  | { type: "model"; id: string }
  | { type: "key"; id: string };

export interface BudgetStatus {
  scope: BudgetScope;
  key: string;
  label: string;
  note?: string;
  unit: "usd" | "tokens";
  limit: number;
  spent: number;
  pct: number;
  alert: boolean;
  alert_at: number;
  exhausted: boolean;
  est_converse: number | null;
  reset_in_ms: number;
  window: "5h" | "24h" | "7day" | "30day";
}
export interface UsageLog {
  ts: number;
  alias: string;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cost: number;
  status: number;
  latency_ms: number;
  stream: number;
  client_key: string;
}
export interface UsageSummary {
  total: { requests: number; tokens_in: number; tokens_out: number; cost: number };
  by_provider: Array<{ provider: string; requests: number; tokens_in: number; tokens_out: number; cost: number }>;
  by_model: Array<{ alias: string; model: string; requests: number; tokens_in: number; tokens_out: number; cost: number }>;
}
export interface UsageSeriesPoint {
  ts: number;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  cost: number;
}
