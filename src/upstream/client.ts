/**
 * Upstream provider client. Translates a canonical request into the provider's
 * native format, calls it, and returns either a parsed canonical response
 * (non-stream) or the raw byte stream (stream — consumed in Phase 3).
 */
import { request } from "undici";
import type { Provider } from "../config.js";
import type { CanonicalRequest, CanonicalResponse } from "../core/canonical.js";
import { adapterFor } from "../adapters/index.js";

export interface UpstreamError extends Error {
  status?: number;
  body?: string;
  /** true if trying a different key/provider might succeed */
  retryable?: boolean;
}

/**
 * Retryable = an availability problem another key/provider could clear: rate
 * limits (429), server errors (5xx), network/timeout (no status). Non-retryable
 * = the request itself is bad (400/401/403/404/422) — falling back just wastes
 * time and spams other providers.
 */
function classifyRetryable(status: number | undefined): boolean {
  if (status === undefined) return true; // network error / timeout / abort
  if (status === 429) return true;
  if (status >= 500) return true;
  return false;
}

function buildHeaders(provider: Provider, key: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(provider.headers ?? {}),
  };
  if (provider.format === "anthropic") {
    if (key) headers["x-api-key"] = key;
    headers["anthropic-version"] ??= "2023-06-01";
  } else if (provider.format === "gemini") {
    if (key) headers["x-goog-api-key"] = key;
  } else {
    if (key) headers["authorization"] = `Bearer ${key}`;
  }
  return headers;
}

/**
 * OpenAI/Anthropic use a fixed path on base_url; Gemini puts the model and
 * stream mode in the path (:generateContent | :streamGenerateContent?alt=sse).
 */
function buildUrl(provider: Provider, model: string, stream: boolean): string {
  const base = provider.base_url.replace(/\/$/, "");
  if (provider.format === "gemini") {
    const method = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${base}/models/${encodeURIComponent(model)}:${method}`;
  }
  return base + (provider.format === "anthropic" ? "/messages" : "/chat/completions");
}

function buildBody(provider: Provider, req: CanonicalRequest, model: string, stream: boolean): unknown {
  const adapter = adapterFor(provider.format);
  const upstreamReq: CanonicalRequest = { ...req, model, stream };
  return adapter.requestFromCanonical(upstreamReq);
}

export interface NonStreamResult {
  stream: false;
  response: CanonicalResponse;
}
export interface StreamResult {
  stream: true;
  body: AsyncIterable<Uint8Array>;
}

export async function callUpstream(
  provider: Provider,
  req: CanonicalRequest,
  model: string,
  opts: { stream: boolean; key?: string; signal?: AbortSignal },
): Promise<NonStreamResult | StreamResult> {
  const url = buildUrl(provider, model, opts.stream);
  const headers = buildHeaders(provider, opts.key);
  const body = buildBody(provider, req, model, opts.stream);

  let res;
  try {
    res = await request(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
      // providers can be slow to first byte on long generations
      headersTimeout: 600_000,
      bodyTimeout: 600_000,
    });
  } catch (e) {
    const err = new Error(`upstream ${provider.id} request failed: ${(e as Error).message}`) as UpstreamError;
    err.retryable = true;
    throw err;
  }

  if (res.statusCode >= 400) {
    const text = await res.body.text();
    const err = new Error(`upstream ${provider.id} returned ${res.statusCode}`) as UpstreamError;
    err.status = res.statusCode;
    err.body = text;
    err.retryable = classifyRetryable(res.statusCode);
    throw err;
  }

  if (opts.stream) return { stream: true, body: res.body };

  const json = await res.body.json();
  const adapter = adapterFor(provider.format);
  return { stream: false, response: adapter.responseToCanonical(json) };
}

export interface PingResult {
  reachable: boolean;
  status?: number;
  ok: boolean; // 2xx — endpoint + key both good
  error?: string;
}

/**
 * Lightweight connectivity check: GET {base}/models with the provider's auth.
 * Any HTTP status means the host is reachable; 2xx means the key is accepted.
 * Never throws — returns a structured result for the dashboard.
 */
export async function pingProvider(provider: Provider, key: string | undefined): Promise<PingResult> {
  const base = provider.base_url.replace(/\/$/, "");
  const url = `${base}/models`;
  const headers = buildHeaders(provider, key);
  try {
    const res = await request(url, { method: "GET", headers, headersTimeout: 10_000, bodyTimeout: 10_000 });
    await res.body.dump();
    return { reachable: true, status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300 };
  } catch (e) {
    return { reachable: false, ok: false, error: (e as Error).message };
  }
}

export { buildHeaders, buildUrl };
