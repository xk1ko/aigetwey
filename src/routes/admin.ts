/**
 * Admin API (/admin/*), behind a single admin password (AIGETWEY_ADMIN_PASSWORD),
 * consumed by the Next.js dashboard via a server-side proxy. Read endpoints
 * expose health/usage/logs; the config endpoints allow live editing with
 * hot-reload.
 *
 * Provider keys are MASKED in every response. The only exception is the explicit
 * `.../reveal` endpoints, which return one raw key on demand (the dashboard's
 * "show key" button) — admin-gated like everything else, for the local operator
 * who forgot what they pasted. Granular provider/combo mutation endpoints land in
 * Phase 11 alongside the dashboard; Phase 5 ships read surfaces + config CRUD.
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
  addProviderModels,
  clearProviderModels,
  setRoute,
  removeRoute,
  setRtk,
  setCaveman,
  setPonytail,
  addServerKey,
  removeServerKey,
  type Config,
  type Provider,
  type EndpointSettings,
} from "../config.js";
import { pingProvider, callUpstream, type UpstreamError } from "../upstream/client.js";
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
  // key_names is keyed by the RAW key — re-key it to the masked form so real
  // keys never leak through /admin/config.
  if (clone.server.key_names) {
    clone.server.key_names = Object.fromEntries(
      Object.entries(clone.server.key_names).map(([k, name]) => [maskKey(k), name]),
    );
  }
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

  // reveal ONE raw provider key (the "show key" button). Index mirrors how the
  // dashboard lists them: api_keys[], or the single api_key as index 0.
  app.get("/admin/providers/:id/keys/:index/reveal", requireAdmin, (req, reply) => {
    const { id, index } = req.params as { id: string; index: string };
    const i = Number(index);
    const provider = deps.state.config.raw.providers.find((p) => p.id === id);
    if (!provider) return reply.code(404).send({ error: `provider "${id}" not found` });
    const keys = provider.api_keys ?? (provider.api_key ? [provider.api_key] : []);
    if (!Number.isInteger(i) || i < 0 || i >= keys.length) {
      return reply.code(404).send({ error: "key index out of range" });
    }
    reply.send({ key: keys[i] });
  });

  app.post("/admin/providers/:id/models", requireAdmin, (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { model?: string; models?: string[]; price_in?: number; price_out?: number };
    // bulk add (from the discover modal) or single add (manual entry).
    if (Array.isArray(b?.models)) {
      if (b.models.length === 0) return reply.code(400).send({ error: "models[] empty" });
      return applyMutation(reply, (c) => addProviderModels(c, id, b.models!));
    }
    if (!b?.model) return reply.code(400).send({ error: "model or models[] required" });
    applyMutation(reply, (c) => addProviderModel(c, id, b.model!, { price_in: b.price_in, price_out: b.price_out }));
  });

  app.delete("/admin/providers/:id/models", requireAdmin, (req, reply) => {
    const { id } = req.params as { id: string };
    applyMutation(reply, (c) => clearProviderModels(c, id));
  });

  app.delete("/admin/providers/:id/models/:model", requireAdmin, (req, reply) => {
    const { id, model } = req.params as { id: string; model: string };
    applyMutation(reply, (c) => removeProviderModel(c, id, decodeURIComponent(model)));
  });

  // Pre-save connectivity check for the add-provider form's "Check" button:
  // ping an ad-hoc provider config without persisting it. Mirrors 9router's
  // validate-before-save. Never stores anything; the key stays in the request.
  app.post("/admin/providers/validate", requireAdmin, async (req, reply) => {
    const b = req.body as { format?: Provider["format"]; base_url?: string; api_key?: string };
    if (!b?.format || !b?.base_url) {
      return reply.code(400).send({ error: "format and base_url required" });
    }
    const probe = {
      id: "_probe",
      format: b.format,
      base_url: b.base_url,
      api_key: b.api_key,
      free: !b.api_key,
      auto_models: false,
      models: [],
      cooldown_base_ms: 1000,
      max_retries: 0,
    } as unknown as Provider;
    reply.send(await pingProvider(probe, b.api_key));
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

  // Test ONE model end-to-end (9router's per-model science button): send a tiny
  // non-stream completion to the provider for that model id and report ok/error.
  // Real upstream call, so it catches "model not found / not entitled" that a
  // /models ping can't.
  app.post("/admin/providers/:id/models/:model/test", requireAdmin, async (req, reply) => {
    const { id, model } = req.params as { id: string; model: string };
    const provider = deps.state.config.raw.providers.find((p) => p.id === id);
    if (!provider) return reply.code(404).send({ error: `provider "${id}" not found` });
    const modelId = decodeURIComponent(model);
    const key = provider.api_keys?.[0] ?? provider.api_key;
    try {
      await callUpstream(
        provider,
        { model: modelId, messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false },
        modelId,
        { stream: false, key },
      );
      reply.send({ ok: true });
    } catch (e) {
      const err = e as UpstreamError;
      reply.send({ ok: false, status: err.status, error: err.message });
    }
  });

  // DISCOVER a provider's catalog without adding anything — returns the full
  // upstream list flagged with which ids are already in config, so the UI can
  // show a checklist instead of dumping every model into the catalog.
  app.post("/admin/providers/:id/connect", requireAdmin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const provider = deps.state.config.getProvider(id);
    if (!provider) return reply.code(404).send({ error: `provider "${id}" not found` });
    const result = await fetchModels(provider);
    if (!result.ok) return reply.code(502).send({ error: result.error ?? "model fetch failed" });
    const have = new Set(provider.models.map((m) => m.id));
    const models = result.models.map((m) => ({ id: m.id, added: have.has(m.id) }));
    reply.send({ ok: true, models });
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

  // ---- combos: client alias -> ordered provider chain + strategy ----

  app.put("/admin/routes/:alias", requireAdmin, (req, reply) => {
    const { alias } = req.params as { alias: string };
    const b = req.body as {
      target?: string[];
      model?: string | string[];
      strategy?: "fallback" | "round-robin";
      price_in?: number;
      price_out?: number;
    };
    if (!Array.isArray(b?.target) || b.target.length === 0) {
      return reply.code(400).send({ error: "target[] required" });
    }
    applyMutation(reply, (c) =>
      setRoute(c, {
        alias: decodeURIComponent(alias),
        target: b.target!,
        model: b.model,
        strategy: b.strategy,
        price_in: b.price_in,
        price_out: b.price_out,
      }),
    );
  });

  app.delete("/admin/routes/:alias", requireAdmin, (req, reply) => {
    const { alias } = req.params as { alias: string };
    applyMutation(reply, (c) => removeRoute(c, decodeURIComponent(alias)));
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
    const b = req.body as { key?: string; name?: string };
    if (!b?.key) return reply.code(400).send({ error: "key required" });
    applyMutation(reply, (c) => addServerKey(c, b.key!, b.name));
  });

  app.delete("/admin/endpoint/keys/:index", requireAdmin, (req, reply) => {
    const { index } = req.params as { index: string };
    const i = Number(index);
    if (!Number.isInteger(i)) return reply.code(400).send({ error: "index must be an integer" });
    applyMutation(reply, (c) => removeServerKey(c, i));
  });

  // reveal ONE raw gateway key (the "show key" button on the Endpoint page).
  app.get("/admin/endpoint/keys/:index/reveal", requireAdmin, (req, reply) => {
    const { index } = req.params as { index: string };
    const i = Number(index);
    const keys = deps.state.config.raw.server.api_keys;
    if (!Number.isInteger(i) || i < 0 || i >= keys.length) {
      return reply.code(404).send({ error: "key index out of range" });
    }
    reply.send({ key: keys[i] });
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
    keys: config.server.api_keys.map((k) => ({ key: maskKey(k), name: config.server.key_names?.[k] })),
  };
}
