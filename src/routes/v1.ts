import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { checkAuth } from "../middleware/auth.js";
import type { GatewayState } from "../core/state.js";
import { handle, GatewayError, type HandleDeps } from "../core/handler.js";
import type { WireFormat } from "../core/canonical.js";
import type { UsageDB } from "../db.js";

/**
 * /v1 proxy surface. Auth-gates on the gateway's own keys (read from state each
 * request so a hot-reload takes effect immediately), then runs the translation
 * pipeline (non-stream JSON or SSE stream).
 */
export function registerV1Routes(app: FastifyInstance, state: GatewayState, db?: UsageDB): void {
  const requireAuth = {
    preHandler: (req: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void) => {
      const res = checkAuth(req, state.config.server.api_keys);
      if (!res.ok) {
        reply.code(res.status ?? 401).send({ error: res.error });
        return; // skip done() to short-circuit the route
      }
      done();
    },
  };

  // build deps from the live holder per request (never close over config/pool).
  const depsNow = (): HandleDeps => ({
    config: state.config,
    pool: state.pool,
    quota: state.quota,
    budget: state.budget,
    db,
    log: (msg) => app.log.info(msg),
  });

  app.post("/v1/chat/completions", requireAuth, (req, reply) => dispatch(depsNow(), "openai", req, reply));
  app.post("/v1/messages", requireAuth, (req, reply) => dispatch(depsNow(), "anthropic", req, reply));
}

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
};

async function dispatch(
  deps: HandleDeps,
  clientFormat: WireFormat,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const controller = new AbortController();
  // abort upstream only if the CLIENT disconnects before we finish the reply.
  reply.raw.on("close", () => {
    if (!reply.raw.writableFinished) controller.abort();
  });

  let result;
  try {
    result = await handle(deps, clientFormat, req.body, controller.signal);
  } catch (e) {
    if (e instanceof GatewayError) {
      reply.code(e.status).send(e.payload);
      return;
    }
    req.log.error(e);
    reply.code(500).send({ error: "internal gateway error" });
    return;
  }

  if (result.sse) {
    reply.raw.writeHead(result.status, SSE_HEADERS);
    try {
      for await (const bytes of result.sse) {
        // respect backpressure: wait for drain when the socket buffer is full.
        if (!reply.raw.write(bytes)) {
          await new Promise((r) => reply.raw.once("drain", r));
        }
      }
    } catch (e) {
      req.log.error(e, "stream error");
    } finally {
      reply.raw.end();
    }
    return;
  }

  reply.code(result.status).send(result.json);
}
