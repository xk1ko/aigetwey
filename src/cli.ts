#!/usr/bin/env node
/**
 * `aigetwey` launcher — one command brings up the whole stack:
 *   - the gateway (Fastify) on its configured port (default 18080)
 *   - the dashboard (Next.js) on port 3000, pointed at the gateway
 *
 * Both run as child processes in THIS terminal (stdio inherited), so Ctrl-C
 * tears down both cleanly — no orphaned background servers. An admin password
 * and session secret are generated if not already in the environment, and the
 * browser is opened once the gateway answers.
 *
 * Prefers a production build when present (dist/server.js, dashboard/.next),
 * otherwise falls back to the tsx / Next dev flow for live reload.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dashboardDir = join(root, "dashboard");

const GATEWAY_PORT = Number(process.env.AIGETWEY_PORT ?? 18080);
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT ?? 3000);

// reuse env secrets if present, otherwise generate (admin) / random (session).
const adminPassword = process.env.AIGETWEY_ADMIN_PASSWORD ?? randomBytes(6).toString("hex");
const sessionSecret = process.env.SESSION_SECRET ?? randomBytes(24).toString("hex");
const generatedPw = !process.env.AIGETWEY_ADMIN_PASSWORD;

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
}

async function waitForGateway(url: string, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      // any HTTP answer (even 401/503) means the port is up
      if (res.status > 0) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const children: ChildProcess[] = [];

function shutdown(): void {
  for (const c of children) {
    if (!c.killed) c.kill("SIGTERM");
  }
}
process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

function spawnGateway(): ChildProcess {
  const built = existsSync(join(root, "dist", "server.js"));
  const [cmd, args] = built ? ["node", ["dist/server.js"]] : ["npx", ["tsx", "src/server.ts"]];
  return spawn(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, AIGETWEY_ADMIN_PASSWORD: adminPassword, AIGETWEY_PORT: String(GATEWAY_PORT) },
  });
}

function spawnDashboard(): ChildProcess {
  // serve the optimized build when present, else dev mode (HMR live-reload).
  const prod = existsSync(join(dashboardDir, ".next", "BUILD_ID"));
  const args = prod ? ["run", "start"] : ["run", "dev"];
  return spawn("npm", args, {
    cwd: dashboardDir,
    stdio: "inherit",
    env: {
      ...process.env,
      PORT: String(DASHBOARD_PORT),
      GATEWAY_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
      ADMIN_PASSWORD: adminPassword,
      SESSION_SECRET: sessionSecret,
    },
  });
}

async function main(): Promise<void> {
  console.log("\n  aigetwey — starting gateway + dashboard\n");

  const gw = spawnGateway();
  children.push(gw);
  gw.on("exit", (code) => {
    console.error(`\n  gateway exited (${code}). shutting down.`);
    shutdown();
    process.exit(code ?? 1);
  });

  const up = await waitForGateway(`http://127.0.0.1:${GATEWAY_PORT}/health`);
  if (!up) {
    console.error("  gateway did not come up in time — check config.yaml / logs above.");
    shutdown();
    process.exit(1);
  }

  // the dashboard is optional: skip it cleanly if it hasn't been scaffolded yet.
  if (!existsSync(join(dashboardDir, "package.json"))) {
    console.log(`\n  gateway   http://127.0.0.1:${GATEWAY_PORT}`);
    console.log("  dashboard not found (dashboard/ not scaffolded) — running gateway only.\n");
    if (generatedPw) console.log(`  admin password (generated): ${adminPassword}\n`);
    return;
  }

  const dash = spawnDashboard();
  children.push(dash);
  dash.on("exit", (code) => {
    console.error(`\n  dashboard exited (${code}). shutting down.`);
    shutdown();
    process.exit(code ?? 1);
  });

  const dashUrl = `http://localhost:${DASHBOARD_PORT}`;
  // give Next a moment to bind, then open the console
  await new Promise((r) => setTimeout(r, 2500));
  console.log(`\n  gateway   http://127.0.0.1:${GATEWAY_PORT}`);
  console.log(`  dashboard ${dashUrl}`);
  if (generatedPw) {
    console.log(`\n  admin password (generated): ${adminPassword}`);
    console.log("  set AIGETWEY_ADMIN_PASSWORD to keep it stable across runs.\n");
  }
  openBrowser(dashUrl);
}

main().catch((e) => {
  console.error(e);
  shutdown();
  process.exit(1);
});
