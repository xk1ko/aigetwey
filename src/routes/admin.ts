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
import {
  maskKey,
  serializeConfig,
  addProvider,
  editProvider,
  removeProvider,
  addProviderKey,
  removeProviderKey,
  addProviderModel,
  removeProviderModel,
  setRoute,
  removeRoute,
  createCombo,
  activateCombo,
  deleteCombo,
  renameCombo,
  copyCombo,
  setRtk,
  setCaveman,
  setPonytail,
  addServerKey,
  removeServerKey,
  type Config,
  type Provider,
  type EndpointSettings,
} from "../config.js";
import { pingProvider } from "../upstream/client.js";
import { fetchModels } from "../providers/free.js";

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

  // per-provider quota: consumed, limit, and ms until the next scheduled reset.
  app.get("/admin/quota", requireAdmin, (_req, reply) => {
    reply.send({ quota: deps.state.quota.snapshot(deps.state.config.listProviders()) });
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

  // Apply a structural mutation: run the pure helper against the real (unmasked)
  // config, then reload(serialized) so validation + atomic persist + pool swap
  // all happen through the one trusted path. Serializing the real config means
  // reload's unmask step is a no-op (no masked values present). Replies with the
  // fresh masked config so the dashboard can re-render from one source of truth.
  const applyMutation = (reply: FastifyReply, mutate: (config: Config) => Config): void => {
    let next: Config;
    try {
      next = mutate(deps.state.config.raw);
    } catch (e) {
      reply.code(400).send({ error: (e as Error).message });
      return;
    }
    try {
      deps.state.reload(serializeConfig(next));
    } catch (e) {
      reply.code(400).send({ error: (e as Error).message });
      return;
    }
    reply.send({ ok: true, config: maskedConfig(deps.state.config.raw) });
  };

  // ---- providers ----

  app.post("/admin/providers", requireAdmin, (req, reply) => {
    const b = req.body as Partial<{
      id: string;
      format: Provider["format"];
      base_url: string;
      api_key: string;
      free: boolean;
      auto_models: boolean;
      service_account: string;
    }>;
    if (!b?.id || !b?.format || !b?.base_url) {
      return reply.code(400).send({ error: "id, format, base_url required" });
    }
    applyMutation(reply, (c) =>
      addProvider(c, {
        id: b.id!,
        format: b.format!,
        base_url: b.base_url!,
        api_key: b.api_key,
        free: b.free,
        auto_models: b.auto_models,
        service_account: b.service_account,
      }),
    );
  });

  app.put("/admin/providers/:id", requireAdmin, (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { base_url?: string; format?: Provider["format"] };
    applyMutation(reply, (c) => editProvider(c, id, { base_url: b?.base_url, format: b?.format }));
  });

  app.delete("/admin/providers/:id", requireAdmin, (req, reply) => {
    const { id } = req.params as { id: string };
    applyMutation(reply, (c) => removeProvider(c, id));
  });

  app.post("/admin/providers/:id/keys", requireAdmin, (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { key?: string };
    if (!b?.key) return reply.code(400).send({ error: "key required" });
    applyMutation(reply, (c) => addProviderKey(c, id, b.key!));
  });

  app.delete("/admin/providers/:id/keys/:index", requireAdmin, (req, reply) => {
    const { id, index } = req.params as { id: string; index: string };
    const i = Number(index);
    if (!Number.isInteger(i)) return reply.code(400).send({ error: "index must be an integer" });
    applyMutation(reply, (c) => removeProviderKey(c, id, i));
  });

  app.post("/admin/providers/:id/models", requireAdmin, (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { model?: string; price_in?: number; price_out?: number };
    if (!b?.model) return reply.code(400).send({ error: "model required" });
    applyMutation(reply, (c) => addProviderModel(c, id, b.model!, { price_in: b.price_in, price_out: b.price_out }));
  });

  app.delete("/admin/providers/:id/models/:model", requireAdmin, (req, reply) => {
    const { id, model } = req.params as { id: string; model: string };
    applyMutation(reply, (c) => removeProviderModel(c, id, decodeURIComponent(model)));
  });

  // live connectivity check against the provider's /models. Uses a real
  // (unmasked) key from the live config; never returns the key itself.
  app.post("/admin/providers/:id/test", requireAdmin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const provider = deps.state.config.raw.providers.find((p) => p.id === id);
    if (!provider) return reply.code(404).send({ error: `provider "${id}" not found` });
    const key = provider.api_keys?.[0] ?? provider.api_key;
    reply.send(await pingProvider(provider, key));
  });

  // fetch a provider's catalog (free passthrough / auto_models) and add any
  // newly discovered model ids to its config catalog.
  app.post("/admin/providers/:id/connect", requireAdmin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const provider = deps.state.config.getProvider(id);
    if (!provider) return reply.code(404).send({ error: `provider "${id}" not found` });
    const result = await fetchModels(provider);
    if (!result.ok) return reply.code(502).send({ error: result.error ?? "model fetch failed" });
    const existing = new Set(provider.models.map((m) => m.id));
    const fresh = result.models.map((m) => m.id).filter((mid) => !existing.has(mid));
    if (fresh.length === 0) {
      return reply.send({ ok: true, added: 0, config: maskedConfig(deps.state.config.raw) });
    }
    let next = deps.state.config.raw;
    for (const mid of fresh) next = addProviderModel(next, id, mid);
    try {
      deps.state.reload(serializeConfig(next));
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    reply.send({ ok: true, added: fresh.length, config: maskedConfig(deps.state.config.raw) });
  });

  // every callable model: provider/model catalog entries + routing aliases.
  app.get("/admin/models", requireAdmin, (_req, reply) => {
    const providers = deps.state.config.listProviders().map((p) => ({
      id: p.id,
      format: p.format,
      models: p.models.map((m) => ({ id: m.id, ref: `${p.id}/${m.id}`, price_in: m.price_in, price_out: m.price_out })),
    }));
    const routes = deps.state.config.listRoutes();
    reply.send({ providers, routes });
  });

  // ---- routing aliases ----

  app.put("/admin/routes/:alias", requireAdmin, (req, reply) => {
    const { alias } = req.params as { alias: string };
    const b = req.body as { target?: string[]; model?: string | string[]; price_in?: number; price_out?: number };
    if (!Array.isArray(b?.target) || b.target.length === 0) {
      return reply.code(400).send({ error: "target[] required" });
    }
    applyMutation(reply, (c) =>
      setRoute(c, { alias, target: b.target!, model: b.model, price_in: b.price_in, price_out: b.price_out }),
    );
  });

  app.delete("/admin/routes/:alias", requireAdmin, (req, reply) => {
    const { alias } = req.params as { alias: string };
    applyMutation(reply, (c) => removeRoute(c, decodeURIComponent(alias)));
  });

  // ---- combos: named snapshots of the routing table ----

  app.get("/admin/combos", requireAdmin, (_req, reply) => {
    reply.send({ combos: deps.state.config.listCombos() });
  });

  app.post("/admin/combos", requireAdmin, (req, reply) => {
    const b = req.body as { name?: string };
    if (!b?.name) return reply.code(400).send({ error: "name required" });
    applyMutation(reply, (c) => createCombo(c, b.name!));
  });

  app.post("/admin/combos/:name/activate", requireAdmin, (req, reply) => {
    const { name } = req.params as { name: string };
    applyMutation(reply, (c) => activateCombo(c, decodeURIComponent(name)));
  });

  app.delete("/admin/combos/:name", requireAdmin, (req, reply) => {
    const { name } = req.params as { name: string };
    applyMutation(reply, (c) => deleteCombo(c, decodeURIComponent(name)));
  });

  app.post("/admin/combos/:name/rename", requireAdmin, (req, reply) => {
    const { name } = req.params as { name: string };
    const b = req.body as { newName?: string };
    if (!b?.newName) return reply.code(400).send({ error: "newName required" });
    applyMutation(reply, (c) => renameCombo(c, decodeURIComponent(name), b.newName!));
  });

  app.post("/admin/combos/:name/copy", requireAdmin, (req, reply) => {
    const { name } = req.params as { name: string };
    const b = req.body as { newName?: string };
    if (!b?.newName) return reply.code(400).send({ error: "newName required" });
    applyMutation(reply, (c) => copyCombo(c, decodeURIComponent(name), b.newName!));
  });

  // ---- endpoint: token-saver toggles + gateway keys ----

  app.get("/admin/endpoint", requireAdmin, (_req, reply) => {
    reply.send(endpointPayload(deps.state.config.raw));
  });

  app.put("/admin/endpoint/rtk", requireAdmin, (req, reply) => {
    const b = req.body as { enabled?: boolean };
    applyMutation(reply, (c) => setRtk(c, !!b?.enabled));
  });

  app.put("/admin/endpoint/caveman", requireAdmin, (req, reply) => {
    const b = req.body as { level?: EndpointSettings["caveman"] };
    if (!isLevel(b?.level)) return reply.code(400).send({ error: "level must be off|lite|full|ultra" });
    applyMutation(reply, (c) => setCaveman(c, b.level!));
  });

  app.put("/admin/endpoint/ponytail", requireAdmin, (req, reply) => {
    const b = req.body as { level?: EndpointSettings["ponytail"] };
    if (!isLevel(b?.level)) return reply.code(400).send({ error: "level must be off|lite|full|ultra" });
    applyMutation(reply, (c) => setPonytail(c, b.level!));
  });

  app.post("/admin/endpoint/keys", requireAdmin, (req, reply) => {
    const b = req.body as { key?: string };
    if (!b?.key) return reply.code(400).send({ error: "key required" });
    applyMutation(reply, (c) => addServerKey(c, b.key!));
  });

  app.delete("/admin/endpoint/keys/:index", requireAdmin, (req, reply) => {
    const { index } = req.params as { index: string };
    const i = Number(index);
    if (!Number.isInteger(i)) return reply.code(400).send({ error: "index must be an integer" });
    applyMutation(reply, (c) => removeServerKey(c, i));
  });
}

function isLevel(v: unknown): v is EndpointSettings["caveman"] {
  return v === "off" || v === "lite" || v === "full" || v === "ultra";
}

/** Endpoint settings: toggles + masked gateway keys + port. */
function endpointPayload(config: Config) {
  return {
    port: config.server.port,
    rtk: config.endpoint.rtk,
    caveman: config.endpoint.caveman,
    ponytail: config.endpoint.ponytail,
    keys: config.server.api_keys.map(maskKey),
  };
}
