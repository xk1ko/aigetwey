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
 * + key rotation (Phase 4) run here. RTK/inject (Phase 6) and usage logging
 * (Phase 5) plug into this same pipeline.
 */
import type { GatewayConfig } from "../config.js";
import type { WireFormat } from "./canonical.js";
import { adapterFor } from "../adapters/index.js";
import type { UpstreamError } from "../upstream/client.js";
import { parseSSE, encodeSSE } from "../stream/sse.js";
import { streamAdapterFor } from "../stream/index.js";
import type { KeyPool } from "./keypool.js";
import { executeWithFallback } from "./fallback.js";

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
  log?: (msg: string) => void;
}

export async function handle(
  deps: HandleDeps,
  clientFormat: WireFormat,
  body: unknown,
  signal?: AbortSignal,
): Promise<HandleResult> {
  const { config, pool } = deps;
  const ingress = adapterFor(clientFormat);
  const canonical = ingress.requestToCanonical(body);

  if (!canonical.model) {
    throw new GatewayError(400, { error: "missing 'model' in request" });
  }

  const routes = config.resolve(canonical.model);
  if (routes.length === 0) {
    throw new GatewayError(404, { error: `unknown model "${canonical.model}"` });
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
    return { status: 200, json: clientBody };
  }

  // streaming: provider SSE -> canonical chunks -> client SSE bytes. The
  // provider and client formats may differ (e.g. an Anthropic client talking to
  // an OpenAI provider), so both ends translate through the canonical chunk.
  const providerStream = streamAdapterFor(route.provider.format);
  const clientStream = streamAdapterFor(clientFormat);
  const canonicalChunks = providerStream.streamToCanonical(parseSSE(result.body));
  const clientEvents = clientStream.streamFromCanonical(canonicalChunks);

  async function* toBytes(): AsyncGenerator<Uint8Array> {
    for await (const ev of clientEvents) {
      yield encodeSSE(ev);
    }
  }

  return { status: 200, sse: toBytes() };
}
