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

  // Pipe Fastify pino logs into the console buffer for the dashboard SSE viewer.
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array, ...args: unknown[]): boolean => {
    const str = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    for (const line of str.split("\n").filter(Boolean)) {
      let level: "LOG" | "INFO" | "WARN" | "ERROR" | "DEBUG" = "LOG";
      if (line.includes('"level":30') || line.includes('"INFO"')) level = "INFO";
      else if (line.includes('"level":40') || line.includes('"WARN"')) level = "WARN";
      else if (line.includes('"level":50') || line.includes('"ERROR"')) level = "ERROR";
      else if (line.includes('"level":20') || line.includes('"DEBUG"')) level = "DEBUG";
      consoleBuffer.push(level, line);
    }
    return origWrite(chunk, ...(args as [BufferEncoding, (err?: Error | null) => void]));
  };

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
