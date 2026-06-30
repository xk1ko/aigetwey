import { checkAuth, extractKey, clientKeyFingerprint } from "@/gw/middleware/auth.js";
import { isKeyExpired } from "@/gw/config.js";
import { handle, GatewayError, type HandleDeps } from "@/gw/core/handler.js";
import type { WireFormat } from "@/gw/core/canonical.js";
import { handleEmbeddings, type EmbeddingsRequest } from "@/gw/core/embeddings.js";
import { gw } from "./gw";

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xreal = req.headers.get("x-real-ip");
  if (xreal) return xreal;
  return "127.0.0.1";
}

function corsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-api-key, anthropic-version",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "0",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

function sseToStream(sse: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iter = sse[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await iter.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch {
        controller.close();
      }
    },
    cancel() {
      iter.return?.();
    },
  });
}

export async function dispatchV1(req: Request, clientFormat: WireFormat): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  const { state, db, notifier, limiter, log } = gw();
  const ip = getClientIp(req);

  const authRes = checkAuth(req.headers, ip, state.config.server.api_keys);
  if (!authRes.ok) {
    return Response.json({ error: authRes.error }, { status: authRes.status ?? 401, headers: { ...SECURITY_HEADERS, ...corsHeaders(req) } });
  }

  const presented = extractKey(req.headers);

  if (presented && isKeyExpired(state.config.server, presented, Date.now())) {
    const expAt = state.config.server.key_expires?.[presented];
    const expDate = expAt ? new Date(expAt).toISOString() : undefined;
    return Response.json({ error: "access key expired", expired_at: expDate }, { status: 403, headers: { ...SECURITY_HEADERS, ...corsHeaders(req) } });
  }

  const rpm = presented ? state.config.server.key_rpm?.[presented] : undefined;
  if (presented && rpm && limiter.over(clientKeyFingerprint(presented), rpm)) {
    return Response.json({ error: `rate limit exceeded — max ${rpm} req/min`, retry_after_ms: 60000 }, { status: 429, headers: { ...SECURITY_HEADERS, ...corsHeaders(req) } });
  }

  const body = await req.json().catch(() => ({}));

  const deps: HandleDeps = {
    config: state.config,
    pool: state.pool,
    budget: state.budget,
    db,
    notifier,
    clientKeyModels: presented ? state.config.server.key_models?.[presented] : undefined,
    clientKeyFp: presented ? clientKeyFingerprint(presented) : undefined,
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
    return new Response(sseToStream(result.sse), {
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

  const { state, db, limiter, log } = gw();
  const ip = getClientIp(req);

  const authRes = checkAuth(req.headers, ip, state.config.server.api_keys);
  if (!authRes.ok) {
    return Response.json({ error: authRes.error }, { status: authRes.status ?? 401, headers: { ...SECURITY_HEADERS, ...corsHeaders(req) } });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  if (!body?.model) return Response.json({ error: "missing 'model'" }, { status: 400, headers: SECURITY_HEADERS });
  if (!body.input) return Response.json({ error: "missing 'input'" }, { status: 400, headers: SECURITY_HEADERS });

  const model = String(body.model);
  const deps: HandleDeps = {
    config: state.config,
    pool: state.pool,
    budget: state.budget,
    db,
    log,
  };

  const routes = deps.config.resolve(model);
  if (routes.length === 0) {
    return Response.json({ error: `unknown model "${model}"` }, { status: 404, headers: SECURITY_HEADERS });
  }

  if (deps.budget) {
    const g = deps.budget.globalStatus();
    if (g?.exhausted) return Response.json({ error: "budget exceeded" }, { status: 402, headers: SECURITY_HEADERS });
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
