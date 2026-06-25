/**
 * Fallback engine. Walks a prioritized chain of routes, rotating keys within
 * each provider, until one succeeds or the chain is exhausted.
 *
 * Streaming note: callUpstream() throws BEFORE returning a stream when the
 * upstream status is >= 400, so the commit point is a 200 response. A failure
 * mid-stream surfaces later during body iteration (in the handler), which we
 * deliberately do NOT retry — fail clean, no duplicate output.
 */
import type { ResolvedRoute } from "../config.js";
import type { CanonicalRequest } from "./canonical.js";
import type { ThinkingConfig } from "../translator/thinkingUnified.js";
import type { KeyPool } from "./keypool.js";
import {
  callUpstream,
  type NonStreamResult,
  type StreamResult,
  type UpstreamError,
} from "../upstream/client.js";

export interface AttemptLog {
  provider: string;
  model: string;
  status?: number;
  outcome: "success" | "retry" | "fallback" | "fatal" | "skip";
  detail?: string;
}

export interface FallbackOpts {
  stream: boolean;
  signal?: AbortSignal;
  onAttempt?: (log: AttemptLog) => void;
  /** which key the pool handed out for the winning attempt (handler uses it for usage). */
  onServed?: (route: ResolvedRoute, key: string) => void;
  /** captured client thinking intent, applied per-attempt in the provider's format. */
  thinkingIntent?: ThinkingConfig | null;
}

export interface FallbackResult {
  /** the route that actually served the request (for response translation) */
  route: ResolvedRoute;
  result: NonStreamResult | StreamResult;
}

export async function executeWithFallback(
  routes: ResolvedRoute[],
  pool: KeyPool,
  req: CanonicalRequest,
  opts: FallbackOpts,
): Promise<FallbackResult> {
  let lastError: UpstreamError | undefined;
  const log = opts.onAttempt ?? (() => {});

  for (const route of routes) {
    const { provider } = route;

    const attempts = provider.max_retries + 1;

    for (let i = 0; i < attempts; i++) {
      const key = pool.pick(provider);
      if (key === null) {
        // every key for this provider is cooling down
        log({ provider: provider.id, model: route.model, outcome: "skip", detail: "all keys cooling down" });
        break;
      }

      try {
        const result = await callUpstream(provider, req, route.model, {
          stream: opts.stream,
          key,
          signal: opts.signal,
          thinkingIntent: opts.thinkingIntent,
        });
        pool.success(provider, key);
        opts.onServed?.(route, key);
        log({ provider: provider.id, model: route.model, status: 200, outcome: "success" });
        return { route, result };
      } catch (e) {
        const err = e as UpstreamError;
        lastError = err;

        if (!err.retryable) {
          // the request itself is bad — falling back won't help
          log({ provider: provider.id, model: route.model, status: err.status, outcome: "fatal" });
          throw err;
        }

        pool.penalize(provider, key, { message: err.message ?? `HTTP ${err.status}`, status: err.status });
        const moreKeysHere = i < attempts - 1 && pool.hasAvailable(provider);
        log({
          provider: provider.id,
          model: route.model,
          status: err.status,
          outcome: moreKeysHere ? "retry" : "fallback",
        });
        if (!moreKeysHere) break; // move to the next provider in the chain
      }
    }
  }

  // chain exhausted
  if (lastError) throw lastError;
  const err = new Error("no available provider for this model") as UpstreamError;
  err.status = 503;
  err.retryable = false;
  throw err;
}
