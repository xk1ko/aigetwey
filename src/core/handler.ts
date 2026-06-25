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
import type { QuotaTracker } from "./quota.js";
import { executeWithFallback } from "./fallback.js";
import { type UsageDB, computeCost } from "../db.js";
import { compressMessages } from "../rtk/index.js";
import { injectInto } from "../inject/index.js";
import { parseSuffix, captureThinking, type ThinkingConfig } from "../translator/thinkingUnified.js";
import { compressWithHeadroom, formatHeadroomLog } from "../headroom/compress.js";
import { getPricingForModel } from "../providers/pricing.js";

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
  quota?: QuotaTracker;
  budget?: {
    globalStatus(): { exhausted: boolean; reset_in_ms: number } | null;
    blocks(providerId: string, model: string): { exhausted: true; reset_in_ms: number } | null;
    blocksKey(fp: string): { exhausted: true; reset_in_ms: number } | null;
  };
  clientKeyFp?: string;
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
  const tokensIn = usage?.prompt_tokens ?? 0;
  const tokensOut = usage?.completion_tokens ?? 0;
  // count the full request against the served provider's window budget.
  deps.quota?.consume(route.provider, tokensIn + tokensOut);
  if (!deps.db) return;
  // Cost: a combo/route may set explicit prices; otherwise fall back to the ported
  // aigetwey pricing table so cost auto-resolves per model instead of showing $0.
  const pricing = getPricingForModel(route.provider.id, route.model);
  const priceIn = route.price_in ?? pricing?.input;
  const priceOut = route.price_out ?? pricing?.output;
  deps.db.record({
    alias: route.alias,
    provider: route.provider.id,
    model: route.model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cached_tokens: usage?.cached_tokens ?? 0,
    cost: computeCost(tokensIn, tokensOut, priceIn, priceOut),
    status,
    latency_ms: latencyMs,
    stream: stream ? 1 : 0,
    client_key: deps.clientKeyFp ?? "",
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

  // Thinking: a model-name suffix like "claude-opus-4-6(high)" or "alias(none)"
  // carries the client's thinking intent. Strip it so routing matches the clean
  // model, and capture the intent (suffix wins, else any reasoning param already
  // in the body). It's applied per-attempt in the served provider's native format
  // (upstream/client.ts), driven by the capabilities table — a no-op for models
  // that can't reason. Matches aigetwey's capture-before-translate flow.
  const { cleanModel, override } = parseSuffix(canonical.model);
  canonical.model = cleanModel;
  const thinkingIntent: ThinkingConfig | null =
    override ?? captureThinking(canonical as Record<string, unknown>);

  let routes = config.resolve(canonical.model);
  if (routes.length === 0) {
    throw new GatewayError(404, { error: `unknown model "${canonical.model}"` });
  }

  // Budget hard-stop. Global overrun fails fast. Provider/model budgets bar the
  // matching routes (like the token-quota skip); if every candidate is barred,
  // there's nothing to serve → 402.
  if (deps.budget) {
    const g = deps.budget.globalStatus();
    if (g?.exhausted) throw new GatewayError(402, { error: "budget exceeded", reset_in_ms: g.reset_in_ms });
    if (deps.clientKeyFp) {
      const kb = deps.budget.blocksKey(deps.clientKeyFp);
      if (kb?.exhausted) throw new GatewayError(402, { error: "budget exceeded", reset_in_ms: kb.reset_in_ms });
    }
    const eligible = routes.filter((r) => !deps.budget!.blocks(r.provider.id, r.model));
    if (eligible.length === 0) {
      const b = deps.budget.blocks(routes[0]!.provider.id, routes[0]!.model);
      throw new GatewayError(402, { error: "budget exceeded", reset_in_ms: b?.reset_in_ms ?? 0 });
    }
    routes = eligible;
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

  // Headroom: pipe the (OpenAI-shaped) messages through the external compression
  // proxy when enabled. Fail-open — on any error the original messages stand and
  // the request proceeds. Runs after RTK/inject so it compresses the final context.
  if (config.endpoint.headroom.enabled) {
    const hr = await compressWithHeadroom(canonical.messages, {
      url: config.endpoint.headroom.url,
      model: canonical.model,
      compressUserMessages: config.endpoint.headroom.compress_user_messages,
    });
    if (hr) {
      canonical.messages = hr.messages;
      const line = formatHeadroomLog(hr);
      if (line) deps.log?.(`[headroom] ${line}`);
    }
  }

  const wantStream = canonical.stream === true;

  let won;
  try {
    won = await executeWithFallback(routes, pool, canonical, {
      stream: wantStream,
      signal,
      thinkingIntent,
      isExhausted: deps.quota ? (p) => deps.quota!.isExhausted(p) : undefined,
      onAttempt: (a) =>
        deps.log?.(`[fallback] ${a.provider}/${a.model} ${a.status ?? "-"} -> ${a.outcome}${a.detail ? ` (${a.detail})` : ""}`),
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
