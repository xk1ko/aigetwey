/**
 * Embeddings handler. Simple JSON-in/JSON-out (no streaming, no RTK/caveman).
 * Routes through the same fallback + key rotation as chat completions.
 *
 * OpenAI-format providers: forward to {base_url}/embeddings as-is.
 * Gemini: translate body → embedContent/batchEmbedContents, normalize response.
 * Anthropic: not supported (no embeddings API).
 */
import { request } from "undici";
import type { Provider, ResolvedRoute } from "../config.js";
import type { KeyPool } from "./keypool.js";
import type { UpstreamError } from "../upstream/client.js";
import { buildHeaders } from "../upstream/client.js";

export interface EmbeddingsRequest {
  model: string;
  input: string | string[];
  encoding_format?: "float" | "base64";
  dimensions?: number;
}

export interface EmbeddingsResult {
  status: number;
  json: unknown;
}

// ---- Gemini translation ----

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

function geminiModelPath(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

function buildGeminiUrl(model: string, input: string | string[], key: string): string {
  const path = geminiModelPath(model);
  const op = Array.isArray(input) ? "batchEmbedContents" : "embedContent";
  return `${GEMINI_BASE}/${path}:${op}?key=${encodeURIComponent(key)}`;
}

function buildGeminiBody(model: string, input: string | string[], dimensions?: number): unknown {
  const m = geminiModelPath(model);
  const hasDim = dimensions != null && Number.isFinite(dimensions) && dimensions > 0;
  if (Array.isArray(input)) {
    return {
      requests: input.map((text) => ({
        model: m,
        content: { parts: [{ text: String(text) }] },
        ...(hasDim ? { outputDimensionality: dimensions } : {}),
      })),
    };
  }
  return {
    model: m,
    content: { parts: [{ text: String(input) }] },
    ...(hasDim ? { outputDimensionality: dimensions } : {}),
  };
}

function normalizeGeminiResponse(body: unknown, model: string): unknown {
  const r = body as Record<string, unknown>;
  // already OpenAI-shaped (shouldn't happen, but guard)
  if (r.object === "list" && Array.isArray(r.data)) return r;

  let items: unknown[] = [];
  if (Array.isArray(r.embeddings)) {
    items = (r.embeddings as Array<{ values?: number[] }>).map((emb, idx) => ({
      object: "embedding",
      index: idx,
      embedding: emb.values ?? [],
    }));
  } else if ((r.embedding as { values?: number[] })?.values) {
    items = [{ object: "embedding", index: 0, embedding: (r.embedding as { values: number[] }).values }];
  }
  return {
    object: "list",
    data: items,
    model,
    usage: { prompt_tokens: 0, total_tokens: 0 },
  };
}

// ---- core call ----

async function callEmbeddings(
  provider: Provider,
  model: string,
  body: EmbeddingsRequest,
  key: string,
  signal?: AbortSignal,
): Promise<{ status: number; json: unknown }> {
  let url: string;
  let headers: Record<string, string>;
  let reqBody: unknown;

  if (provider.format === "gemini") {
    url = buildGeminiUrl(model, body.input, key);
    headers = { "content-type": "application/json" };
    reqBody = buildGeminiBody(model, body.input, body.dimensions);
  } else {
    // OpenAI-compatible (openai, openrouter, mistral, together, etc.)
    const base = provider.base_url.replace(/\/$/, "");
    url = `${base}/embeddings`;
    headers = buildHeaders(provider, key);
    reqBody = {
      model,
      input: body.input,
      ...(body.encoding_format ? { encoding_format: body.encoding_format } : {}),
      ...(body.dimensions != null ? { dimensions: body.dimensions } : {}),
    };
  }

  let res;
  try {
    res = await request(url, {
      method: "POST",
      headers,
      body: JSON.stringify(reqBody),
      signal,
      headersTimeout: 60_000,
      bodyTimeout: 60_000,
    });
  } catch (e) {
    const err = new Error(`upstream ${provider.id} embeddings failed: ${(e as Error).message}`) as UpstreamError;
    err.retryable = true;
    throw err;
  }

  if (res.statusCode >= 400) {
    const text = await res.body.text();
    const err = new Error(`upstream ${provider.id} returned ${res.statusCode}`) as UpstreamError;
    err.status = res.statusCode;
    err.body = text;
    err.retryable = res.statusCode === 429 || res.statusCode >= 500;
    throw err;
  }

  const json = await res.body.json();
  if (provider.format === "gemini") {
    return { status: 200, json: normalizeGeminiResponse(json, model) };
  }
  return { status: 200, json };
}

// ---- fallback loop (mirrors chat's executeWithFallback, simplified) ----

export async function handleEmbeddings(
  routes: ResolvedRoute[],
  pool: KeyPool,
  body: EmbeddingsRequest,
  opts: { signal?: AbortSignal; log?: (msg: string) => void },
): Promise<EmbeddingsResult> {
  let lastError: UpstreamError | undefined;

  for (const route of routes) {
    const { provider } = route;
    if (provider.format === "anthropic") {
      opts.log?.(`[embeddings] skip ${provider.id} — anthropic has no embeddings API`);
      continue;
    }

    const attempts = provider.max_retries + 1;
    for (let i = 0; i < attempts; i++) {
      const key = pool.pick(provider);
      if (key === null) {
        opts.log?.(`[embeddings] skip ${provider.id} — all keys cooling down`);
        break;
      }

      try {
        const result = await callEmbeddings(provider, route.model, body, key, opts.signal);
        pool.success(provider, key);
        opts.log?.(`[embeddings] ${provider.id}/${route.model} -> 200`);
        return result;
      } catch (e) {
        const err = e as UpstreamError;
        lastError = err;

        if (!err.retryable) throw err;

        pool.penalize(provider, key, { message: err.message, status: err.status });
        const moreKeys = i < attempts - 1 && pool.hasAvailable(provider);
        opts.log?.(`[embeddings] ${provider.id}/${route.model} ${err.status ?? "ERR"} -> ${moreKeys ? "retry" : "fallback"}`);
        if (!moreKeys) break;
      }
    }
  }

  if (lastError) throw lastError;
  const err = new Error("no available provider for embeddings") as UpstreamError;
  err.status = 503;
  err.retryable = false;
  throw err;
}
