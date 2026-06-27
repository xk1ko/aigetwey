import Fastify from "fastify";
import { resolve, join } from "node:path";
import { loadConfig } from "./config.js";
import { getDataDir, getConfigPath } from "./appDirs.js";
import { registerRoutes } from "./routes/index.js";
import { GatewayState } from "./core/state.js";
import { UsageDB } from "./db.js";
import { AuthStore } from "./core/authStore.js";
import { consoleBuffer } from "./core/console-buffer.js";

async function main(): Promise<void> {
  const configPath = getConfigPath();

  let config;
  try {
    config = loadConfig(configPath);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }

  // Tee pino's output into the console buffer for the dashboard's live SSE viewer.
  // pino (sonic-boom) writes straight to fd 1, bypassing process.stdout.write — so
  // we hand it an explicit destination stream instead of patching stdout, otherwise
  // app.log.* lines never reach the buffer and the Server Console looks dead.
  const logStream = {
    write(line: string): boolean {
      process.stdout.write(line);
      for (const raw of line.split("\n")) {
        if (!raw.trim()) continue;
        try {
          const o = JSON.parse(raw) as { level?: number; msg?: unknown; reqId?: string };
          const lvl =
            (o.level ?? 30) >= 50 ? "ERROR" : (o.level ?? 30) >= 40 ? "WARN" : (o.level ?? 30) >= 20 ? "INFO" : "DEBUG";
          const msg = typeof o.msg === "string" ? o.msg : o.msg !== undefined ? JSON.stringify(o.msg) : raw.trim();
          consoleBuffer.push(lvl, o.reqId ? `[${o.reqId}] ${msg}` : msg);
        } catch {
          consoleBuffer.push("LOG", raw.trim());
        }
      }
      return true;
    },
  };

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info", stream: logStream },
    bodyLimit: 32 * 1024 * 1024,
  });

  // Security headers — safe defaults for all responses.
  app.addHook("onSend", (_req, reply, payload, done) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("X-XSS-Protection", "0");
    reply.header("Referrer-Policy", "no-referrer");
    if (!reply.hasHeader("Cache-Control")) {
      reply.header("Cache-Control", "no-store");
    }
    done(null, payload);
  });

  // CORS — allow any origin for /v1 (LLM clients), block dashboard from foreign origins.
  app.addHook("onRequest", (req, reply, done) => {
    const origin = req.headers.origin;
    if (req.url?.startsWith("/v1")) {
      reply.header("Access-Control-Allow-Origin", origin ?? "*");
      reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type, x-api-key, anthropic-version");
      reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      if (req.method === "OPTIONS") { reply.code(204).send(); return; }
    }
    done();
  });

  const dataDir = getDataDir();
  const db = new UsageDB(join(dataDir, "usage.sqlite"));

  // holder enables runtime config edits (hot-reload) from the dashboard.
  const state = new GatewayState(configPath, config, db);
  // admin password lives in a hash store (seeded from the env on first run,
  // changeable at runtime from the dashboard).
  const auth = AuthStore.open(dataDir, process.env.AIGETWEY_ADMIN_PASSWORD);

  registerRoutes(app, state, db, auth);

  // Single-URL mode: when the launcher runs the dashboard on an internal port,
  // reverse-proxy everything the gateway doesn't own (the UI, /api/gw, /_next…)
  // to it. The API routes above (/v1, /admin, /health) are more specific than the
  // proxy's catch-all, so client traffic stays direct on Fastify — only the
  // low-traffic dashboard is proxied. One address serves both.
  const dashUpstream = process.env.AIGETWEY_DASHBOARD_PORT;
  if (dashUpstream) {
    await app.register(import("@fastify/http-proxy"), {
      upstream: `http://127.0.0.1:${dashUpstream}`,
      prefix: "/",
      // forward the whole HTTP surface the dashboard needs (pages + its API).
      httpMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
      // forward WebSocket upgrades too, so `next dev`'s HMR socket works when the
      // dashboard is proxied — this is what lets dev run single-URL on the gateway
      // port like production. Harmless for the prebuilt prod dashboard (no socket).
      websocket: true,
      // keep the ORIGINAL Host so Next builds redirects (e.g. → /login) against
      // the gateway's address, not the internal dashboard port.
      replyOptions: {
        rewriteRequestHeaders: (req, headers) => ({ ...headers, host: req.headers.host ?? headers.host }),
      },
    });
  }

  const close = () => {
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);

  try {
    const port = process.env.AIGETWEY_PORT ? Number(process.env.AIGETWEY_PORT) : config.server.port;
    const host = config.server.host;

    if (host !== "127.0.0.1" && host !== "localhost" && config.server.api_keys.length === 0) {
      app.log.warn("⚠ SECURITY: binding on %s with NO api_keys — all requests unauthenticated!", host);
      app.log.warn("⚠ Set server.api_keys in config.yaml or AIGETWEY_ADMIN_PASSWORD to secure the gateway.");
    }

    await app.listen({ host, port });
    app.log.info(`aigetwey listening on http://${host}:${port}`);
  } catch (e) {
    app.log.error(e);
    process.exit(1);
  }
}

main();
