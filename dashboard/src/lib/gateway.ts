import "server-only";
import { adminPassword } from "./session";

/**
 * Server-side proxy to the gateway admin API. Runs only in Next.js server
 * context (route handlers / server components) — injects the admin password as
 * a Bearer token so it never reaches the browser.
 *
 * Scoped to the admin surface the gateway exposes today (usage, logs, providers,
 * quota, whole-config CRUD). Granular provider/combo mutation helpers are added
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
        authorization: `Bearer ${adminPassword()}`,
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

/** Verify the admin password against the gateway (used at login). */
export async function checkGatewayAuth(): Promise<boolean> {
  const r = await call("GET", "/admin/providers");
  return r.ok;
}

export const gateway = {
  providers: () => call<{ providers: ProviderSnapshot[] }>("GET", "/admin/providers"),
  quota: () => call<{ quota: QuotaSnapshot[] }>("GET", "/admin/quota"),
  logs: (limit = 100) => call<{ logs: UsageLog[] }>("GET", `/admin/logs?limit=${limit}`),
  usage: (since = 0) => call<UsageSummary>("GET", `/admin/usage?since=${since}`),
  usageSeries: (since: number, bucket: number) =>
    call<{ series: UsageSeriesPoint[] }>("GET", `/admin/usage/series?since=${since}&bucket=${bucket}`),
  config: () => call<unknown>("GET", "/admin/config"),
  putConfig: (text: string) => call<{ ok: boolean; config: unknown }>("PUT", "/admin/config", { text }),
};

// ---- shapes mirrored from the gateway admin API ----

export interface KeySnapshot {
  key: string;
  healthy: boolean;
  cooldown_ms: number;
  fail_count: number;
}
export interface ProviderSnapshot {
  id: string;
  format: "openai" | "anthropic" | "gemini";
  keys: KeySnapshot[];
}
export interface QuotaSnapshot {
  provider: string;
  window: "5h" | "daily" | "weekly" | "monthly";
  consumed: number;
  limit_tokens?: number;
  reset_in_ms: number;
  pct?: number;
  exhausted: boolean;
}
export interface UsageLog {
  ts: number;
  alias: string;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cached_tokens: number;
  cost: number;
  status: number;
  latency_ms: number;
  stream: number;
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
