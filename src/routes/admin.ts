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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { GatewayState } from "../core/state.js";
import type { UsageDB } from "../db.js";
import { checkAdminAuth, type AdminVerifier } from "../middleware/auth.js";
import {
  maskKey,
  serializeConfig,
  addProvider,
  editProvider,
  renameProvider,
  removeProvider,
  addProviderKey,
  removeProviderKey,
  editProviderKey,
  reorderProviderKey,
  toggleProviderKey,
  setProviderStrategy,
  setProviderDisabled,
  addProviderModel,
  removeProviderModel,
  addProviderModels,
  clearProviderModels,
  setProviderModelPrice,
  setRoute,
  removeRoute,
  setRtk,
  setCaveman,
  setPonytail,
  setHeadroom,
  addServerKey,
  editServerKey,
  removeServerKey,
  setBudget,
  clearBudget,
  type Config,
  type Provider,
  type EndpointSettings,
  type Budget,
} from "../config.js";
import { pingProvider } from "../upstream/client.js";
import { handle, GatewayError } from "../core/handler.js";
import { fetchModels } from "../providers/free.js";
import { consoleBuffer } from "../core/console-buffer.js";
import { getPricingForModel } from "../providers/pricing.js";
import { getHeadroomStatus, isLoopbackHeadroomUrl, DEFAULT_HEADROOM_URL } from "../headroom/detect.js";
import { startHeadroomProxy, stopHeadroomProxy, getManagedPid, getHeadroomLogTail } from "../headroom/process.js";

export interface AdminDeps {
  state: GatewayState;
  db?: UsageDB;
  auth: AdminVerifier & { change(current: string, next: string): { ok: boolean; error?: string } };
}

/** Deep-clone the raw config and mask every secret for display. */
function maskedConfig(config: Config): Config {
  const clone: Config = JSON.parse(JSON.stringify(config));
  for (const p of clone.providers) {
    if (p.api_key) p.api_key = maskKey(p.api_key);
    if (p.api_keys) p.api_keys = p.api_keys.map(maskKey);
    // key_names is keyed by the RAW key — re-key to the masked form so real keys
    // never leak through /admin/config.
    if (p.key_names) {
      p.key_names = Object.fromEntries(
        Object.entries(p.key_names).map(([k, name]) => [maskKey(k), name]),
      );
    }
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
      const res = checkAdminAuth(req, deps.auth);
      if (!res.ok) {
        reply.code(res.status ?? 401).send({ error: res.error });
        return;
      }
      done();
    },
  };

  // change the admin password: verify the current one, then persist the new hash.
  // The dashboard re-issues its session cookie with the new password on success.
  app.put("/admin/password", requireAdmin, (req, reply) => {
    const body = (req.body ?? {}) as { current?: unknown; next?: unknown };
    if (typeof body.current !== "string" || typeof body.next !== "string") {
      return reply.code(400).send({ error: "current and next are required" });
    }
    const r = deps.auth.change(body.current, body.next);
    if (!r.ok) return reply.code(400).send({ error: r.error });
    return reply.send({ ok: true });
  });

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
    reply.send({
      quota: deps.state.quota.snapshot(deps.state.config.listProviders()),
      budget: deps.state.budget.status(),
    });
  });

  // set/replace the gateway-wide budget. Body = Budget; invalid shape -> 400.
  app.put("/admin/budget", requireAdmin, (req, reply) => {
    const b = (req.body ?? {}) as Budget;
    applyMutation(reply, (c) => setBudget(c, b));
  });

  // remove the gateway-wide budget (feature off).
  app.delete("/admin/budget", requireAdmin, (_req, reply) => {
    applyMutation(reply, clearBudget);
  });

  // current config, secrets masked
  app.get("/admin/config", requireAdmin, (_req, reply) => {
    reply.send(maskedConfig(deps.state.config.raw));
  });

  // export the FULL config as YAML for backup — UNMASKED (real keys), so the
  // backup can actually be restored. Admin-gated and same-origin only, like the
  // /reveal endpoints that already hand back raw keys; intended for the local
  // operator backing up their own gateway. Import is the existing PUT /admin/config.
  app.get("/admin/config/export", requireAdmin, (_req, reply) => {
    reply
      .header("Content-Type", "text/yaml; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="aigetwey-config.yaml"')
      .send(serializeConfig(deps.state.config.raw));
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
    const b = req.body as { base_url?: string; format?: Provider["format"]; name?: string };
    applyMutation(reply, (c) => editProvider(c, id, { base_url: b?.base_url, format: b?.format, name: b?.name }));
  });

  // rename a provider's id (the call prefix); cascades to combos that target it.
  app.put("/admin/providers/:id/rename", requireAdmin, (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { id?: string };
    if (!b?.id) return reply.code(400).send({ error: "new id required" });
    applyMutation(reply, (c) => renameProvider(c, id, b.id!));
  });

  app.delete("/admin/providers/:id", requireAdmin, (req, reply) => {
    const { id } = req.params as { id: string };
    applyMutation(reply, (c) => removeProvider(c, id));
  });

  app.post("/admin/providers/:id/keys", requireAdmin, (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { key?: string; name?: string };
    if (!b?.key) return reply.code(400).send({ error: "key required" });
    applyMutation(reply, (c) => addProviderKey(c, id, b.key!, b.name));
  });

  // edit ONE provider key: rename and/or swap its value (aigetwey-style).
  app.put("/admin/providers/:id/keys/:index", requireAdmin, (req, reply) => {
    const { id, index } = req.params as { id: string; index: string };
    const i = Number(index);
    if (!Number.isInteger(i)) return reply.code(400).send({ error: "index must be an integer" });
    const b = req.body as { key?: string; name?: string };
    applyMutation(reply, (c) => editProviderKey(c, id, i, { key: b?.key, name: b?.name }));
  });

  app.delete("/admin/providers/:id/keys/:index", requireAdmin, (req, reply) => {
    const { id, index } = req.params as { id: string; index: string };
    const i = Number(index);
    if (!Number.isInteger(i)) return reply.code(400).send({ error: "index must be an integer" });
    applyMutation(reply, (c) => removeProviderKey(c, id, i));
  });

  app.put("/admin/providers/:id/keys/reorder", requireAdmin, (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { from?: number; to?: number };
    if (!Number.isInteger(b?.from) || !Number.isInteger(b?.to)) {
      return reply.code(400).send({ error: "from and to must be integers" });
    }
    applyMutation(reply, (c) => reorderProviderKey(c, id, b.from!, b.to!));
  });

  app.put("/admin/providers/:id/keys/:index/toggle", requireAdmin, (req, reply) => {
    const { id, index } = req.params as { id: string; index: string };
    const i = Number(index);
    if (!Number.isInteger(i)) return reply.code(400).send({ error: "index must be an integer" });
    const b = req.body as { enabled?: boolean };
    if (typeof b?.enabled !== "boolean") return reply.code(400).send({ error: "enabled (boolean) required" });
    applyMutation(reply, (c) => toggleProviderKey(c, id, i, b.enabled!));
  });

  app.put("/admin/providers/:id/strategy", requireAdmin, (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { strategy?: "fallback" | "round-robin" | null; sticky?: number };
    applyMutation(reply, (c) => setProviderStrategy(c, id, b?.strategy ?? null, b?.sticky));
  });

  app.put("/admin/providers/:id/disabled", requireAdmin, (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { disabled?: boolean };
    applyMutation(reply, (c) => setProviderDisabled(c, id, b?.disabled === true));
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

  // remove one model (?model=<id>) or clear all (no query). Model ids can hold
  // slashes (e.g. "anthropic/claude-opus-4-6"); a %2F path segment gets re-split
  // by the dashboard proxy, so the id travels as a query param instead.
  app.delete("/admin/providers/:id/models", requireAdmin, (req, reply) => {
    const { id } = req.params as { id: string };
    const model = (req.query as { model?: string }).model;
    if (model) return applyMutation(reply, (c) => removeProviderModel(c, id, model));
    applyMutation(reply, (c) => clearProviderModels(c, id));
  });

  // Pre-save connectivity check for the add-provider form's "Check" button:
  // ping an ad-hoc provider config without persisting it. Matches aigetwey's
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

  // Test ONE key: ping the provider's /models with that specific key, so the
  // operator can tell which of several keys is live. Index is numeric (no slash
  // hazard), so it stays a path param.
  app.post("/admin/providers/:id/keys/:index/test", requireAdmin, async (req, reply) => {
    const { id, index } = req.params as { id: string; index: string };
    const provider = deps.state.config.raw.providers.find((p) => p.id === id);
    if (!provider) return reply.code(404).send({ error: `provider "${id}" not found` });
    const keys = provider.api_keys ?? (provider.api_key ? [provider.api_key] : []);
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= keys.length) {
      return reply.code(404).send({ error: "key index out of range" });
    }
    reply.send(await pingProvider(provider, keys[i]));
  });

  // Test ONE model end-to-end (aigetwey's per-model science button). Routes through
  // the real pipeline via handle(), so the ping lands in usage/quota exactly like
  // a normal call — and it catches "model not found / not entitled" a /models
  // ping can't. Model id travels as ?model= to survive slashes through the proxy.
  app.post("/admin/providers/:id/models/test", requireAdmin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const modelId = (req.query as { model?: string }).model;
    if (!modelId) return reply.code(400).send({ error: "model query param required" });
    const provider = deps.state.config.raw.providers.find((p) => p.id === id);
    if (!provider) return reply.code(404).send({ error: `provider "${id}" not found` });
    try {
      await handle(
        { config: deps.state.config, pool: deps.state.pool, db: deps.db, quota: deps.state.quota },
        "openai",
        { model: `${id}/${modelId}`, messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false },
      );
      reply.send({ ok: true });
    } catch (e) {
      if (e instanceof GatewayError) {
        const msg = typeof e.payload === "string" ? e.payload
          : (e.payload as { error?: string })?.error ?? JSON.stringify(e.payload);
        return reply.send({ ok: false, status: e.status, error: msg });
      }
      reply.send({ ok: false, error: (e as Error).message });
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

  // pricing overview: every provider/model with its config override (if any) and
  // the auto-resolved default from the pricing table. Drives the Settings editor.
  app.get("/admin/pricing", requireAdmin, (_req, reply) => {
    const providers = deps.state.config.listProviders().map((p) => ({
      id: p.id,
      models: p.models.map((m) => {
        const def = getPricingForModel(p.id, m.id);
        return {
          id: m.id,
          price_in: m.price_in ?? null,
          price_out: m.price_out ?? null,
          default_in: def?.input ?? null,
          default_out: def?.output ?? null,
        };
      }),
    }));
    reply.send({ providers });
  });

  // set/clear a model's price override (per 1M tokens). model travels in the body
  // (can hold slashes); null clears the override → cost falls back to the table.
  app.put("/admin/providers/:id/models/price", requireAdmin, (req, reply) => {
    const { id } = req.params as { id: string };
    const b = req.body as { model?: string; price_in?: number | null; price_out?: number | null };
    if (!b?.model) return reply.code(400).send({ error: "model required" });
    applyMutation(reply, (c) => setProviderModelPrice(c, id, b.model!, { price_in: b.price_in, price_out: b.price_out }));
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

  app.put("/admin/endpoint/headroom", requireAdmin, (req, reply) => {
    const b = req.body as { enabled?: boolean; url?: string; compress_user_messages?: boolean };
    applyMutation(reply, (c) =>
      setHeadroom(c, { enabled: b?.enabled, url: b?.url, compress_user_messages: b?.compress_user_messages }),
    );
  });

  app.post("/admin/endpoint/keys", requireAdmin, (req, reply) => {
    const b = req.body as { key?: string; name?: string };
    if (!b?.key) return reply.code(400).send({ error: "key required" });
    applyMutation(reply, (c) => addServerKey(c, b.key!, b.name));
  });

  // rename ONE gateway key's label (the Endpoint page's edit-name button).
  app.put("/admin/endpoint/keys/:index", requireAdmin, (req, reply) => {
    const { index } = req.params as { index: string };
    const i = Number(index);
    if (!Number.isInteger(i)) return reply.code(400).send({ error: "index must be an integer" });
    const b = req.body as { name?: string };
    applyMutation(reply, (c) => editServerKey(c, i, { name: b?.name }));
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

  // ---- headroom: external context-compression proxy lifecycle ----

  app.get("/admin/headroom/status", requireAdmin, async (_req, reply) => {
    const hr = deps.state.config.raw.endpoint.headroom;
    const url = hr.url || DEFAULT_HEADROOM_URL;
    const status = await getHeadroomStatus(url);
    reply.send({
      ...status,
      url,
      managedPid: getManagedPid(),
      enabled: hr.enabled,
      compress_user_messages: hr.compress_user_messages,
    });
  });

  app.post("/admin/headroom/start", requireAdmin, async (_req, reply) => {
    const url = deps.state.config.raw.endpoint.headroom.url || DEFAULT_HEADROOM_URL;
    if (!isLoopbackHeadroomUrl(url)) {
      return reply
        .code(400)
        .send({ error: "external headroom proxies must be started outside aigetwey", code: "EXTERNAL_PROXY" });
    }
    let port = 8787;
    try {
      const p = parseInt(new URL(url).port, 10);
      if (p > 0 && p < 65536) port = p;
    } catch {
      /* default */
    }
    try {
      const result = await startHeadroomProxy({ port });
      reply.send({ success: true, ...result });
    } catch (e) {
      const err = e as Error & { code?: string };
      reply.code(err.code === "NOT_INSTALLED" ? 400 : 500).send({ error: err.message, code: err.code ?? null });
    }
  });

  app.post("/admin/headroom/stop", requireAdmin, (_req, reply) => {
    try {
      const result = stopHeadroomProxy();
      reply.code(result.stopped ? 200 : 409).send(result);
    } catch (e) {
      const err = e as Error & { code?: string };
      reply.code(500).send({ error: err.message, code: err.code ?? null });
    }
  });

  app.get("/admin/headroom/log", requireAdmin, (_req, reply) => {
    reply.send({ log: getHeadroomLogTail() });
  });

  // ---- console log SSE stream ----

  app.get("/admin/console/stream", requireAdmin, (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // stop reverse proxies / Next's prod server from buffering the stream.
      "X-Accel-Buffering": "no",
    });

    const recent = consoleBuffer.recent();
    reply.raw.write(`data: ${JSON.stringify({ type: "init", logs: recent })}\n\n`);

    const unsub = consoleBuffer.subscribe((entry) => {
      reply.raw.write(`data: ${JSON.stringify({ type: "line", ...entry })}\n\n`);
    });

    // heartbeat: keeps the connection (and any proxy in between) alive while idle,
    // so the viewer stays "Connected" instead of silently dropping.
    const keepalive = setInterval(() => reply.raw.write(": keepalive\n\n"), 15000);

    req.raw.on("close", () => {
      clearInterval(keepalive);
      unsub();
    });
  });

  app.delete("/admin/console", requireAdmin, (_req, reply) => {
    consoleBuffer.clear();
    reply.send({ ok: true });
  });

  // ---- version: current build + best-effort npm "update available" check ----
  // Poll npm for the latest published version; a newer semver flips an
  // "update available" flag in the dashboard. Best-effort — failures leave
  // `latest` null and never show a false positive.
  app.get("/admin/version", requireAdmin, async (_req, reply) => {
    const current = readVersion();
    let latest: string | null = null;
    try {
      const res = await fetch("https://registry.npmjs.org/aigetwey/latest", {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const j = (await res.json()) as { version?: string };
        latest = j.version ?? null;
      }
    } catch {
      /* offline or unpublished — leave latest null (no update info) */
    }
    reply.send({ current, latest, updateAvailable: !!(latest && isNewerVersion(latest, current)) });
  });

  // ---- shutdown: stop the gateway process (dashboard power button) ----
  // Matches aigetwey's POST /api/shutdown: reply first, then exit after a short
  // delay so the response reaches the browser. Admin-gated like everything else;
  // the DB is closed cleanly (same path as the SIGINT/SIGTERM handler).
  app.post("/admin/shutdown", requireAdmin, (_req, reply) => {
    app.log.warn("[admin] shutdown requested via dashboard");
    reply.send({ ok: true, message: "shutting down" });
    setTimeout(() => {
      deps.db?.close();
      process.exit(0);
    }, 300);
  });
}

function isLevel(v: unknown): v is EndpointSettings["caveman"] {
  return v === "off" || v === "lite" || v === "full" || v === "ultra";
}

/** Current package version, read from the repo's package.json (cwd). */
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** True if semver `a` is strictly newer than `b` (numeric compare, ignores pre-release). */
function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Endpoint settings: toggles + masked gateway keys + port. */
function endpointPayload(config: Config) {
  return {
    port: config.server.port,
    rtk: config.endpoint.rtk,
    caveman: config.endpoint.caveman,
    ponytail: config.endpoint.ponytail,
    headroom: config.endpoint.headroom,
    keys: config.server.api_keys.map((k) => ({ key: maskKey(k), name: config.server.key_names?.[k] })),
  };
}
