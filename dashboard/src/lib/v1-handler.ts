import { checkAuth, extractKey, clientKeyFingerprint } from "@/gw/middleware/auth.js";
import { isKeyExpired } from "@/gw/config.js";
import { handle, GatewayError, type HandleDeps } from "@/gw/core/handler.js";
import type { WireFormat } from "@/gw/core/canonical.js";
import { handleEmbeddings, type EmbeddingsRequest } from "@/gw/core/embeddings.js";
import { gw } from "./gw";
import { SECURITY_HEADERS, corsHeaders, bodyTooLarge } from "./http";

function getClientIp(req: Request): string {
  // Set by the net-preload.cjs http.createServer patch (see src/cli.ts), which
  // only forwards X-Forwarded-For/X-Real-IP when the TCP peer itself is
  // loopback. If the header is missing (preload didn't load), fail SAFE —
  // "unknown" never matches the loopback check in checkAuth(), so auth blocks
  // rather than silently trusting a client-supplied header.
  return req.headers.get("x-aigloo-real-ip") ?? "unknown";
}

function sseToStream(sse: AsyncIterable<Uint8Array>, log: (msg: string) => void): ReadableStream<Uint8Array> {
  const iter = sse[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await iter.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (e) {
        log(`[v1] stream error: ${(e as Error).message}`);
        controller.close();
      }
    },
    cancel() {
      iter.return?.();
    },
  });
}

export type AuthOutcome =
  | { ok: true; presented: string | null; clientKeyFp: string | undefined; clientKeyModels: string[] | undefined }
  | { ok: false; response: Response };

/**
 * Shared auth preamble for every /v1/* endpoint: loopback-safe IP → api-key
 * check → expiry → rpm limit. Kept in one place so a new endpoint (like
 * embeddings previously) can't skip a check by not being wired up here.
 * Exported for direct unit testing (tests/key-expiry-route.test.ts) — it only
 * needs `g.state.config.server.*` and `g.limiter`, so tests build a minimal
 * fake `g` instead of driving the whole gw() singleton through real config
 * files and a real sqlite db.
 */
export function authenticateV1(req: Request, g: ReturnType<typeof gw>): AuthOutcome {
  const { state, limiter } = g;
  const ip = getClientIp(req);
  const headers = { ...SECURITY_HEADERS, ...corsHeaders(req) };

  const authRes = checkAuth(req.headers, ip, state.config.server.api_keys);
  if (!authRes.ok) {
    return { ok: false, response: Response.json({ error: authRes.error }, { status: authRes.status ?? 401, headers }) };
  }

  if (bodyTooLarge(req)) {
    return { ok: false, response: Response.json({ error: "request body too large" }, { status: 413, headers }) };
  }

  const presented = extractKey(req.headers);

  if (presented && isKeyExpired(state.config.server, presented, Date.now())) {
    const expAt = state.config.server.key_expires?.[presented];
    const expDate = expAt ? new Date(expAt).toISOString() : undefined;
    return { ok: false, response: Response.json({ error: "access key expired", expired_at: expDate }, { status: 403, headers }) };
  }

  const rpm = presented ? state.config.server.key_rpm?.[presented] : undefined;
  if (presented && rpm && limiter.over(clientKeyFingerprint(presented), rpm)) {
    return { ok: false, response: Response.json({ error: `rate limit exceeded — max ${rpm} req/min`, retry_after_ms: 60000 }, { status: 429, headers }) };
  }

  return {
    ok: true,
    presented,
    clientKeyFp: presented ? clientKeyFingerprint(presented) : undefined,
    clientKeyModels: presented ? state.config.server.key_models?.[presented] : undefined,
  };
}

export async function dispatchV1(req: Request, clientFormat: WireFormat): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  const g = gw();
  const auth = authenticateV1(req, g);
  if (!auth.ok) return auth.response;

  const { state, db, notifier, log } = g;
  const body = await req.json().catch(() => ({}));

  const deps: HandleDeps = {
    config: state.config,
    pool: state.pool,
    budget: state.budget,
    db,
    notifier,
    clientKeyModels: auth.clientKeyModels,
    clientKeyFp: auth.clientKeyFp,
    log,
  };

  let result;
  try {
    result = await handle(deps, clientFormat, body, req.signal);
  } catch (e) {
    if (e instanceof GatewayError) {
      return Response.json(e.payload, { status: e.status, headers: { ...SECURITY_HEADERS, ...corsHeaders(req) } });
    }
    log(`[v1] internal error: ${(e as Error).message}`);
    return Response.json({ error: "internal gateway error" }, { status: 500, headers: { ...SECURITY_HEADERS, ...corsHeaders(req) } });
  }

  const baseHeaders = { ...SECURITY_HEADERS, ...corsHeaders(req) };

  if (result.sse) {
    return new Response(sseToStream(result.sse, log), {
      status: result.status,
      headers: {
        ...baseHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  return Response.json(result.json, { status: result.status, headers: { ...baseHeaders, "Content-Type": "application/json" } });
}

export async function dispatchEmbeddings(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  const g = gw();
  const auth = authenticateV1(req, g);
  if (!auth.ok) return auth.response;

  const { state, db, log } = g;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (!body?.model) return Response.json({ error: "missing 'model'" }, { status: 400, headers: SECURITY_HEADERS });
  if (!body.input) return Response.json({ error: "missing 'input'" }, { status: 400, headers: SECURITY_HEADERS });

  const model = String(body.model);
  const deps: HandleDeps = {
    config: state.config,
    pool: state.pool,
    budget: state.budget,
    db,
    clientKeyModels: auth.clientKeyModels,
    clientKeyFp: auth.clientKeyFp,
    log,
  };

  const routes = deps.config.resolve(model);
  if (routes.length === 0) {
    return Response.json({ error: `unknown model "${model}"` }, { status: 404, headers: SECURITY_HEADERS });
  }

  if (deps.budget) {
    const budgetStatus = deps.budget.globalStatus();
    if (budgetStatus?.exhausted) return Response.json({ error: "budget exceeded" }, { status: 402, headers: SECURITY_HEADERS });
    if (deps.clientKeyFp) {
      const kb = deps.budget.blocksKey(deps.clientKeyFp);
      if (kb?.exhausted) return Response.json({ error: "budget exceeded" }, { status: 402, headers: SECURITY_HEADERS });
    }
  }

  try {
    const result = await handleEmbeddings(routes, state.pool, body as unknown as EmbeddingsRequest, {
      signal: undefined,
      log,
    });
    return Response.json(result.json, { status: result.status, headers: { ...SECURITY_HEADERS, "Content-Type": "application/json" } });
  } catch (e) {
    const err = e as { status?: number; body?: string; message?: string };
    const status = err.status ?? 502;
    let payload: unknown = { error: err.message };
    if (err.body) {
      try { payload = JSON.parse(err.body); } catch { payload = { error: err.body }; }
    }
    return Response.json(payload, { status, headers: SECURITY_HEADERS });
  }
}
