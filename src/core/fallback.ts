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

const MAX_RETRIES = 2;
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

    const attempts = MAX_RETRIES + 1;

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
          // Non-retryable on THIS route doesn't mean non-retryable everywhere: a
          // malformed request (400/404/422) will fail identically on every
          // provider, but a 401/403 is frequently provider/key-specific (an
          // expired key, or a provider that mislabels "no balance" as "invalid
          // key" — this happens in practice) and a different provider in the
          // chain may serve it fine. Don't retry more keys within this same
          // route (that would just repeat the same rejection), but do move on
          // to the next route rather than aborting the whole chain. Only
          // surfaces as a real failure if every route in the chain fails too
          // (see `if (lastError) throw lastError` below).
          log({ provider: provider.id, model: route.model, status: err.status, outcome: "fatal" });
          break;
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
