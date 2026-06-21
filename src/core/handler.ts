/**
 * Core request pipeline, independent of which client endpoint was hit.
 *
 *   client body (clientFormat)
 *     -> ingress adapter        -> canonical request
 *     -> config.resolve(model)  -> prioritized provider chain + upstream model
 *     -> fallback engine        -> rotate keys, walk the chain until one serves
 *     -> provider reply         -> canonical -> egress adapter -> client body
 *
 * Streaming (Phase 3): provider SSE -> canonical chunks -> client SSE. Fallback
 * + key rotation (Phase 4) run here. RTK compression + caveman/ponytail
 * injection (Phase 6) transform the request before routing; usage logging
 * (Phase 5) records each served request.
 */
import type { GatewayConfig, ResolvedRoute } from "../config.js";
import type { WireFormat, CanonicalUsage } from "./canonical.js";
import { adapterFor } from "../adapters/index.js";
import type { UpstreamError } from "../upstream/client.js";
import { parseSSE, encodeSSE } from "../stream/sse.js";
import { streamAdapterFor } from "../stream/index.js";
import type { CanonicalChunk } from "../stream/chunk.js";
import type { KeyPool } from "./keypool.js";
import { executeWithFallback } from "./fallback.js";
import { type UsageDB, computeCost } from "../db.js";
import { compressMessages } from "../rtk/index.js";
import { injectInto } from "../inject/index.js";

export interface HandleResult {
  status: number;
  /** non-streaming JSON reply */
  json?: unknown;
  /** streaming reply: an async iterable of SSE bytes */
  sse?: AsyncIterable<Uint8Array>;
}

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(typeof payload === "string" ? payload : JSON.stringify(payload));
  }
}

export interface HandleDeps {
  config: GatewayConfig;
  pool: KeyPool;
  db?: UsageDB;
  log?: (msg: string) => void;
  now?: () => number;
}

function recordUsage(
  deps: HandleDeps,
  route: ResolvedRoute,
  usage: CanonicalUsage | undefined,
  status: number,
  latencyMs: number,
  stream: boolean,
): void {
  if (!deps.db) return;
  const tokensIn = usage?.prompt_tokens ?? 0;
  const tokensOut = usage?.completion_tokens ?? 0;
  deps.db.record({
    alias: route.alias,
    provider: route.provider.id,
    model: route.model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cached_tokens: usage?.cached_tokens ?? 0,
    cost: computeCost(tokensIn, tokensOut, route.price_in, route.price_out),
    status,
    latency_ms: latencyMs,
    stream: stream ? 1 : 0,
  });
}

export async function handle(
  deps: HandleDeps,
  clientFormat: WireFormat,
  body: unknown,
  signal?: AbortSignal,
): Promise<HandleResult> {
  const { config, pool } = deps;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const ingress = adapterFor(clientFormat);
  const canonical = ingress.requestToCanonical(body);

  if (!canonical.model) {
    throw new GatewayError(400, { error: "missing 'model' in request" });
  }

  const routes = config.resolve(canonical.model);
  if (routes.length === 0) {
    throw new GatewayError(404, { error: `unknown model "${canonical.model}"` });
  }

  // Pipeline order matters: RTK compresses tool_result in the INPUT first, then
  // inject prepends the output-style system prompt. They touch different parts
  // of the request and stack cleanly. Both run before routing so every fallback
  // attempt sends the same transformed request.
  if (config.endpoint.rtk) {
    const stats = compressMessages(canonical.messages);
    if (stats.hits > 0) {
      const pct = Math.round((1 - stats.bytesOut / stats.bytesIn) * 100);
      deps.log?.(
        `[rtk] compressed ${stats.hits} tool output(s): ${stats.bytesIn}B -> ${stats.bytesOut}B (${pct}%) via [${stats.shapes.join(",")}]`,
      );
    }
  }

  // fail-open: an injection error must never break the request.
  try {
    const injected = injectInto(canonical, {
      caveman: config.endpoint.caveman,
      ponytail: config.endpoint.ponytail,
    });
    if (injected) deps.log?.(`[inject] caveman=${config.endpoint.caveman} ponytail=${config.endpoint.ponytail}`);
  } catch (e) {
    deps.log?.(`[inject] skipped (error): ${(e as Error).message}`);
  }

  const wantStream = canonical.stream === true;

  let won;
  try {
    won = await executeWithFallback(routes, pool, canonical, {
      stream: wantStream,
      signal,
      onAttempt: (a) =>
        deps.log?.(`[fallback] ${a.provider} ${a.status ?? "-"} -> ${a.outcome}${a.detail ? ` (${a.detail})` : ""}`),
    });
  } catch (e) {
    const err = e as UpstreamError;
    const status = err.status ?? 502;
    let payload: unknown = { error: err.message };
    if (err.body) {
      try {
        payload = JSON.parse(err.body);
      } catch {
        payload = { error: err.body };
      }
    }
    throw new GatewayError(status, payload);
  }

  const { route, result } = won;

  if (!result.stream) {
    const clientBody = ingress.responseFromCanonical(result.response);
    recordUsage(deps, route, result.response.usage, 200, now() - startedAt, false);
    return { status: 200, json: clientBody };
  }

  // streaming: provider SSE -> canonical chunks -> client SSE bytes. The
  // provider and client formats may differ (e.g. an Anthropic client talking to
  // an OpenAI provider), so both ends translate through the canonical chunk.
  const providerStream = streamAdapterFor(route.provider.format);
  const clientStream = streamAdapterFor(clientFormat);
  const canonicalChunks = providerStream.streamToCanonical(parseSSE(result.body));

  // tap the canonical chunk stream to capture usage from the final chunk(s),
  // which arrive as partial fields across multiple chunks.
  let lastUsage: CanonicalUsage | undefined;
  async function* tap(): AsyncGenerator<CanonicalChunk> {
    for await (const chunk of canonicalChunks) {
      if (chunk.usage) {
        lastUsage = {
          prompt_tokens: chunk.usage.prompt_tokens ?? lastUsage?.prompt_tokens ?? 0,
          completion_tokens: chunk.usage.completion_tokens ?? lastUsage?.completion_tokens ?? 0,
          total_tokens: 0,
          cached_tokens: chunk.usage.cached_tokens ?? lastUsage?.cached_tokens,
        };
      }
      yield chunk;
    }
  }

  const clientEvents = clientStream.streamFromCanonical(tap());

  async function* toBytes(): AsyncGenerator<Uint8Array> {
    try {
      for await (const ev of clientEvents) {
        yield encodeSSE(ev);
      }
    } finally {
      // record once the stream drains (or the client disconnects) so usage is
      // captured even on early termination.
      recordUsage(deps, route, lastUsage, 200, now() - startedAt, true);
    }
  }

  return { status: 200, sse: toBytes() };
}
