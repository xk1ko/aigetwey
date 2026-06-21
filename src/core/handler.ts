/**
 * Core request pipeline, independent of which client endpoint was hit.
 *
 *   client body (clientFormat)
 *     -> ingress adapter        -> canonical request
 *     -> config.resolve(model)  -> provider chain + upstream model
 *     -> upstream call          (canonical -> provider format, inside client)
 *     -> provider reply         -> canonical -> egress adapter -> client body
 *
 * Phase 2 is non-streaming and tries only the FIRST route with the FIRST key.
 * Fallback across the chain + key rotation land in Phase 4; RTK/inject in Phase
 * 6; usage logging in Phase 5. Each plugs into this same pipeline.
 */
import type { GatewayConfig } from "../config.js";
import type { WireFormat } from "./canonical.js";
import { adapterFor } from "../adapters/index.js";
import { callUpstream, type UpstreamError } from "../upstream/client.js";

export interface HandleResult {
  status: number;
  /** non-streaming JSON reply */
  json?: unknown;
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

  if (canonical.stream === true) {
    // streaming pipeline lands in Phase 3; reject explicitly rather than
    // silently returning a non-stream body a streaming client can't parse.
    throw new GatewayError(501, { error: "streaming not implemented yet (Phase 3)" });
  }

  const route = routes[0]!;
  const provider = route.provider;

  let result;
  try {
    result = await callUpstream(provider, canonical, route.model, {
      stream: false,
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

  if (result.stream) {
    // unreachable: we requested stream:false. Guard keeps the type narrow.
    throw new GatewayError(500, { error: "unexpected stream from upstream" });
  }

  const clientBody = ingress.responseFromCanonical(result.response);
  return { status: 200, json: clientBody };
}
