/**
 * Core request pipeline, independent of which client endpoint was hit.
 *
 *   client body (clientFormat)
 *     -> ingress adapter        -> canonical request
 *     -> config.resolve(model)  -> provider chain + upstream model
 *     -> upstream call          (canonical -> provider format, inside client)
 *     -> provider reply         -> canonical -> egress adapter -> client body
 *
 * Phase 2 ships non-streaming; Phase 3 adds the streaming path (provider SSE ->
 * canonical chunks -> client SSE). Both try only the FIRST route with the FIRST
 * key — fallback across the chain + key rotation land in Phase 4; RTK/inject in
 * Phase 6; usage logging in Phase 5. Each plugs into this same pipeline.
 */
import type { GatewayConfig } from "../config.js";
import type { WireFormat } from "./canonical.js";
import { adapterFor } from "../adapters/index.js";
import { callUpstream, type UpstreamError } from "../upstream/client.js";
import { parseSSE, encodeSSE } from "../stream/sse.js";
import { streamAdapterFor } from "../stream/index.js";

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
  log?: (msg: string) => void;
}

/** First configured key for a provider (keypool rotation arrives in Phase 4). */
function firstKey(provider: { api_key?: string; api_keys?: string[] }): string | undefined {
  if (provider.api_keys && provider.api_keys.length > 0) return provider.api_keys[0];
  return provider.api_key;
}

export async function handle(
  deps: HandleDeps,
  clientFormat: WireFormat,
  body: unknown,
  signal?: AbortSignal,
): Promise<HandleResult> {
  const { config } = deps;
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
  const route = routes[0]!;
  const provider = route.provider;

  let result;
  try {
    result = await callUpstream(provider, canonical, route.model, {
      stream: wantStream,
      key: firstKey(provider),
      signal,
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

  if (!result.stream) {
    const clientBody = ingress.responseFromCanonical(result.response);
    return { status: 200, json: clientBody };
  }

  // streaming: provider SSE -> canonical chunks -> client SSE bytes. The
  // provider and client formats may differ (e.g. an Anthropic client talking to
  // an OpenAI provider), so both ends translate through the canonical chunk.
  const providerStream = streamAdapterFor(provider.format);
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
