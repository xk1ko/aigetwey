import Fastify from "fastify";
import { resolve, join } from "node:path";
import { loadConfig } from "./config.js";
import { registerRoutes } from "./routes/index.js";
import { GatewayState } from "./core/state.js";
import { UsageDB } from "./db.js";
import { QuotaTracker } from "./core/quota.js";

async function main(): Promise<void> {
  const configPath = resolve(process.env.AIGETWEY_CONFIG ?? "config.yaml");

  let config;
  try {
    config = loadConfig(configPath);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
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
    await app.listen({ host: config.server.host, port: config.server.port });
    app.log.info(`aigetwey listening on http://${config.server.host}:${config.server.port}`);
  } catch (e) {
    app.log.error(e);
    process.exit(1);
  }
}

main();
