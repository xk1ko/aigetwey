"use client";

/**
 * Browser-side admin client. Talks to the gateway THROUGH the same-origin proxy
 * (`/api/gw/admin/...`), which injects the admin Bearer server-side — so the
 * password never reaches the browser. Server components read initial data via
 * lib/gateway.ts directly; client components mutate through here.
 */
import type {
  ConfigReply,
  EndpointPayload,
  InjectLevel,
  PingResult,
  ProviderSnapshot,
  QuotaSnapshot,
  WireFormat,
} from "./gateway";

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

async function api<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/gw${path}`, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return { ok: false, status: 0, data: null, error: (e as Error).message };
  }
  const text = await res.text();
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: string } | null)?.error ?? `request failed (${res.status})`;
    return { ok: false, status: res.status, data, error: err };
  }
  return { ok: true, status: res.status, data };
}

export const adminApi = {
  providers: () => api<{ providers: ProviderSnapshot[] }>("GET", "/admin/providers"),
  quota: () => api<{ quota: QuotaSnapshot[] }>("GET", "/admin/quota"),

  addProvider: (p: {
    id: string;
    format: WireFormat;
    base_url: string;
    api_key?: string;
    free?: boolean;
    auto_models?: boolean;
    service_account?: string;
  }) => api<ConfigReply>("POST", "/admin/providers", p),
  editProvider: (id: string, patch: { base_url?: string; format?: WireFormat }) =>
    api<ConfigReply>("PUT", `/admin/providers/${encodeURIComponent(id)}`, patch),
  removeProvider: (id: string) => api<ConfigReply>("DELETE", `/admin/providers/${encodeURIComponent(id)}`),
  addKey: (id: string, key: string) =>
    api<ConfigReply>("POST", `/admin/providers/${encodeURIComponent(id)}/keys`, { key }),
  removeKey: (id: string, index: number) =>
    api<ConfigReply>("DELETE", `/admin/providers/${encodeURIComponent(id)}/keys/${index}`),
  addModel: (id: string, model: string, price?: { price_in?: number; price_out?: number }) =>
    api<ConfigReply>("POST", `/admin/providers/${encodeURIComponent(id)}/models`, { model, ...price }),
  addModels: (id: string, models: string[]) =>
    api<ConfigReply>("POST", `/admin/providers/${encodeURIComponent(id)}/models`, { models }),
  removeModel: (id: string, model: string) =>
    api<ConfigReply>("DELETE", `/admin/providers/${encodeURIComponent(id)}/models/${encodeURIComponent(model)}`),
  clearModels: (id: string) => api<ConfigReply>("DELETE", `/admin/providers/${encodeURIComponent(id)}/models`),
  testProvider: (id: string) => api<PingResult>("POST", `/admin/providers/${encodeURIComponent(id)}/test`),
  // discover: returns the upstream catalog flagged with which ids are in config.
  discoverModels: (id: string) =>
    api<{ ok: boolean; models: Array<{ id: string; added: boolean }> }>(
      "POST",
      `/admin/providers/${encodeURIComponent(id)}/connect`,
    ),

  setRoute: (
    alias: string,
    body: { target: string[]; model?: string | string[]; strategy?: "fallback" | "round-robin"; price_in?: number; price_out?: number },
  ) => api<ConfigReply>("PUT", `/admin/routes/${encodeURIComponent(alias)}`, body),
  removeRoute: (alias: string) => api<ConfigReply>("DELETE", `/admin/routes/${encodeURIComponent(alias)}`),

  endpoint: () => api<EndpointPayload>("GET", "/admin/endpoint"),
  setRtk: (enabled: boolean) => api<ConfigReply>("PUT", "/admin/endpoint/rtk", { enabled }),
  setCaveman: (level: InjectLevel) => api<ConfigReply>("PUT", "/admin/endpoint/caveman", { level }),
  setPonytail: (level: InjectLevel) => api<ConfigReply>("PUT", "/admin/endpoint/ponytail", { level }),
  addServerKey: (key: string) => api<ConfigReply>("POST", "/admin/endpoint/keys", { key }),
  removeServerKey: (index: number) => api<ConfigReply>("DELETE", `/admin/endpoint/keys/${index}`),

  putConfig: (text: string) => api<{ ok: boolean }>("PUT", "/admin/config", { text }),
};
