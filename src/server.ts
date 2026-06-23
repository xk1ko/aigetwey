import Fastify from "fastify";
import { resolve, join } from "node:path";
import { loadConfig } from "./config.js";
import { registerRoutes } from "./routes/index.js";
import { GatewayState } from "./core/state.js";
import { UsageDB } from "./db.js";
import { QuotaTracker } from "./core/quota.js";
import { consoleBuffer } from "./core/console-buffer.js";

async function main(): Promise<void> {
  const configPath = resolve(process.env.AIGETWEY_CONFIG ?? "config.yaml");

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
    // gateway proxies large prompts; raise the JSON body cap.
    bodyLimit: 32 * 1024 * 1024,
  });

  // unified data dir (default ./data); usage tracking lives here.
  const dataDir = resolve(process.env.AIGETWEY_DATA_DIR ?? "data");
  const db = new UsageDB(join(dataDir, "usage.sqlite"));

  // quota counts persist via the DB so a restart within a window keeps the budget.
  const quota = new QuotaTracker(Date.now, {
    load: () => db.loadQuota(),
    save: (id, start, consumed) => db.saveQuota(id, start, consumed),
  });

  // holder enables runtime config edits (hot-reload) from the dashboard.
  const state = new GatewayState(configPath, config, quota);
  const adminPassword = process.env.AIGETWEY_ADMIN_PASSWORD;

  registerRoutes(app, state, db, adminPassword);

  const close = () => {
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);

  try {
    // AIGETWEY_PORT (set by the CLI launcher) overrides the config port so the
    // launcher can pin the gateway port without editing config.yaml.
    const port = process.env.AIGETWEY_PORT ? Number(process.env.AIGETWEY_PORT) : config.server.port;
    await app.listen({ host: config.server.host, port });
    app.log.info(`aigetwey listening on http://${config.server.host}:${port}`);
  } catch (e) {
    app.log.error(e);
    process.exit(1);
  }
}

main();
