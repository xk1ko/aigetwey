import type { FastifyInstance, FastifyReply } from "fastify";
import { checkAuth } from "../middleware/auth.js";
import type { GatewayState } from "../core/state.js";

/**
 * /v1 proxy surface. Phase 1 ships auth-gated 501 stubs so the gateway keys can
 * be exercised end to end; the translation pipeline lands in Phase 2.
 */
export function registerV1Routes(app: FastifyInstance, state: GatewayState): void {
  // read keys from state each request so a hot-reload takes effect immediately.
  const requireAuth = {
    preHandler: (
      req: import("fastify").FastifyRequest,
      reply: FastifyReply,
      done: (err?: Error) => void,
    ) => {
      const res = checkAuth(req, state.config.server.api_keys);
      if (!res.ok) {
        reply.code(res.status ?? 401).send({ error: res.error });
        return; // skip done() to short-circuit the route
      }
      done();
    },
  };

  const notImplemented = (_req: unknown, reply: FastifyReply) =>
    reply.code(501).send({ error: "not implemented yet (Phase 2)" });

  app.post("/v1/chat/completions", requireAuth, notImplemented);
  app.post("/v1/messages", requireAuth, notImplemented);
}
