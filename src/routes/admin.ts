/**
 * Admin API (/admin/*), behind a single admin password (AIGETWEY_ADMIN_PASSWORD),
 * consumed by the Next.js dashboard via a server-side proxy. Read endpoints
 * expose health/usage/logs; the config endpoints allow live editing with
 * hot-reload.
 *
 * Provider keys are MASKED in every response — raw secrets never leave here.
 * Granular provider/combo mutation endpoints land in Phase 11 alongside the
 * dashboard that drives them; Phase 5 ships read surfaces + whole-config CRUD.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { GatewayState } from "../core/state.js";
import type { UsageDB } from "../db.js";
import { checkAdminAuth } from "../middleware/auth.js";
import { maskKey, type Config } from "../config.js";

export interface AdminDeps {
  state: GatewayState;
  db?: UsageDB;
  password: string | undefined;
}

/** Deep-clone the raw config and mask every secret for display. */
function maskedConfig(config: Config): Config {
  const clone: Config = JSON.parse(JSON.stringify(config));
  for (const p of clone.providers) {
    if (p.api_key) p.api_key = maskKey(p.api_key);
    if (p.api_keys) p.api_keys = p.api_keys.map(maskKey);
  }
  clone.server.api_keys = clone.server.api_keys.map(maskKey);
  return clone;
}

export function registerAdminRoutes(app: FastifyInstance, deps: AdminDeps): void {
  const requireAdmin = {
    preHandler: (req: FastifyRequest, reply: FastifyReply, done: (e?: Error) => void) => {
      const res = checkAdminAuth(req, deps.password);
      if (!res.ok) {
        reply.code(res.status ?? 401).send({ error: res.error });
        return;
      }
      done();
    },
  };

  app.get("/admin/usage", requireAdmin, (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "usage tracking disabled" });
    const q = req.query as { since?: string };
    const since = q.since ? Number(q.since) : 0;
    reply.send(deps.db.summary(Number.isFinite(since) ? since : 0));
  });

  app.get("/admin/usage/series", requireAdmin, (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "usage tracking disabled" });
    const q = req.query as { since?: string; bucket?: string };
    const since = Number(q.since);
    const bucket = Number(q.bucket);
    const sinceMs = Number.isFinite(since) && since > 0 ? since : Date.now() - 24 * 3600 * 1000;
    const bucketMs = Number.isFinite(bucket) && bucket > 0 ? bucket : 3600 * 1000;
    reply.send({ series: deps.db.series(sinceMs, bucketMs) });
  });

  app.get("/admin/logs", requireAdmin, (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "usage tracking disabled" });
    const q = req.query as { limit?: string };
    const limit = q.limit ? Number(q.limit) : 100;
    reply.send({ logs: deps.db.recent(Number.isFinite(limit) ? limit : 100) });
  });

  // live key health per provider, masked. Drives provider status lamps.
  app.get("/admin/providers", requireAdmin, (_req, reply) => {
    reply.send({ providers: deps.state.pool.snapshot(deps.state.config.listProviders()) });
  });

  // current config, secrets masked
  app.get("/admin/config", requireAdmin, (_req, reply) => {
    reply.send(maskedConfig(deps.state.config.raw));
  });

  // replace config (full YAML/JSON), validate + hot-reload. raw text in body.
  app.put("/admin/config", requireAdmin, (req, reply) => {
    const body = req.body as { text?: string } | string;
    const text = typeof body === "string" ? body : body?.text;
    if (typeof text !== "string" || !text.trim()) {
      return reply.code(400).send({ error: "body must include config text" });
    }
    try {
      deps.state.reload(text);
    } catch (e) {
      // validation failed — old config still serving
      return reply.code(400).send({ error: (e as Error).message });
    }
    app.log.warn("[admin] config hot-reloaded");
    reply.send({ ok: true, config: maskedConfig(deps.state.config.raw) });
  });
}
