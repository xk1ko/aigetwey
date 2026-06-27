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
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, copyFileSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { ensureTrayRuntime } from "./cli/tray/trayRuntime.js";
import { initTray, killTray } from "./cli/tray/tray.js";
import { enableAutoStart } from "./cli/tray/autostart.js";
import { getDataDir, getConfigPath } from "./appDirs.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dashboardDir = join(root, "dashboard");

// ── CLI flags (aigetwey-style): -p/--port, -n/--no-browser, -y/--yes, -h/--help ──
interface CliOpts {
  port?: number;
  noBrowser: boolean;
  yes: boolean;
  help: boolean;
  version: boolean;
  tray: boolean;
  skipUpdate: boolean;
}
function parseArgs(argv: string[]): CliOpts {
  const o: CliOpts = { noBrowser: false, yes: false, help: false, version: false, tray: false, skipUpdate: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-p" || a === "--port") o.port = Number(argv[++i]);
    else if (a === "-n" || a === "--no-browser") o.noBrowser = true;
    else if (a === "-y" || a === "--yes") o.yes = true;
    else if (a === "-t" || a === "--tray") o.tray = true;
    else if (a === "--skip-update") o.skipUpdate = true;
    else if (a === "-v" || a === "--version") o.version = true;
    else if (a === "-h" || a === "--help") o.help = true;
  }
  return o;
}
const opts = parseArgs(process.argv.slice(2));

const HELP = `
  aigetwey — personal AI gateway + dashboard

  Usage: aigetwey [options]

  Options:
    -p, --port <n>    port for the gateway + dashboard, one URL (default 18080)
    -n, --no-browser  start without opening the browser (terminal logs only)
    -y, --yes         skip the interactive menu (just run; honors --no-browser)
    -t, --tray        run in the system tray (background, no terminal needed)
    -v, --version     print version and exit
    -h, --help        show this help

  With a TTY and no --yes, a menu lets you pick: Web UI / Terminal / Hide to Tray / Exit.
`;

const GATEWAY_PORT = opts.port ?? Number(process.env.AIGETWEY_PORT ?? 18080);
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT ?? 18081);

const adminPassword = process.env.AIGETWEY_ADMIN_PASSWORD ?? "123456";
const generatedPw = !process.env.AIGETWEY_ADMIN_PASSWORD;

/**
 * The dashboard session cookie is signed+encrypted with SESSION_SECRET. A fresh
 * random secret each boot would invalidate every cookie on restart — the symptom
 * being "re-enter the password after a relaunch" — so persist a generated one to
 * the data dir (alongside auth.json) and reuse it. An explicit env var wins.
 */
function loadOrCreateSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const dataDir = getDataDir();
  const file = join(dataDir, "session-secret");
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {
    // not created yet — fall through and generate.
  }
  const secret = randomBytes(24).toString("hex");
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, secret, { mode: 0o600 });
  } catch {
    // unwritable data dir — fall back to an ephemeral secret (cookies won't
    // survive this boot, but the gateway still runs).
  }
  return secret;
}
const sessionSecret = loadOrCreateSessionSecret();

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
}

async function waitForGateway(
  url: string,
  timeoutMs = 20000,
  ready: (status: number) => boolean = (s) => s > 0,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      // default: any HTTP answer (even 401/503) means the port is up. A caller
      // can demand more — e.g. a non-5xx, to wait past a proxy's boot-time 502/500
      // while the upstream it fronts is still coming up.
      if (ready(res.status)) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const children: ChildProcess[] = [];

/**
 * Kill a child AND its descendants. npm/npx spawn grandchildren (next-server,
 * tsx→node); signalling only the direct child leaves those orphaned, holding
 * their ports and breaking the next run. Children are spawned detached (own
 * process group), so a negative-pid signal reaches the whole group.
 */
function killTree(c: ChildProcess, sig: NodeJS.Signals = "SIGTERM"): void {
  if (!c.pid || c.killed) return;
  try {
    process.kill(-c.pid, sig);
  } catch {
    try {
      c.kill(sig);
    } catch {
      // already gone
    }
  }
}

function shutdown(): void {
  void killTray();
  for (const c of children) killTree(c);
}

/** The pid listening on a TCP port, or null. Best-effort, POSIX-only. */
function pidOnPort(port: number): number | null {
  for (const probe of [
    `ss -ltnHp 'sport = :${port}' 2>/dev/null`,
    `lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null`,
  ]) {
    try {
      const out = execSync(probe, { encoding: "utf8" });
      const m = out.match(/pid=(\d+)/) ?? out.match(/^\s*(\d+)\s*$/m);
      if (m) return Number(m[1]);
    } catch {
      // tool absent or nothing listening — try the next probe
    }
  }
  return null;
}

/**
 * Make sure `port` is free before we bind it. A leftover dev server (next/node/
 * tsx) from a previous run that died ungracefully is reaped automatically — the
 * zero-config promise is "just run", not "go hunt a stray pid". A port held by
 * something unrelated is left alone and surfaced as a clear error.
 */
async function ensurePortFree(port: number, envVar: string): Promise<void> {
  if (process.platform === "win32") return;
  const pid = pidOnPort(port);
  if (!pid) return;

  let cmd = "";
  try {
    cmd = execSync(`ps -p ${pid} -o command= 2>/dev/null`, { encoding: "utf8" });
  } catch {
    // ps failed — fall through to the unknown-owner branch
  }

  if (!/aigetwey/.test(cmd)) {
    console.error(
      `  port ${port} is in use by another process (pid ${pid}). free it or set ${envVar}.`,
    );
    process.exit(1);
  }

  console.log(`  port ${port} held by a stale dev server (pid ${pid}) — reaping it.`);
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already exiting
  }
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && pidOnPort(port)) {
    await new Promise((r) => setTimeout(r, 150));
  }
  if (pidOnPort(port)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // gone between checks
    }
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
    detached: true, // own process group → killTree reaps tsx→node grandchildren
    env: {
      ...process.env,
      AIGETWEY_ADMIN_PASSWORD: adminPassword,
      AIGETWEY_PORT: String(GATEWAY_PORT),
      AIGETWEY_DATA_DIR: getDataDir(),
      AIGETWEY_CONFIG: getConfigPath(),
      AIGETWEY_DASHBOARD_PORT: String(DASHBOARD_PORT),
    },
  });
}

function spawnDashboard(): ChildProcess {
  const standaloneDir = join(dashboardDir, ".next", "standalone");
  const standaloneServer = join(standaloneDir, "server.js");

  // Standalone build ships pre-bundled deps in vendor/ (renamed from node_modules
  // to survive npm pack which strips node_modules/). NODE_PATH resolves them.
  if (existsSync(standaloneServer)) {
    return spawn("node", [standaloneServer], {
      cwd: standaloneDir,
      stdio: "inherit",
      detached: true,
      env: {
        ...process.env,
        PORT: String(DASHBOARD_PORT),
        HOSTNAME: "127.0.0.1",
        NODE_PATH: join(standaloneDir, "vendor"),
        GATEWAY_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
        ADMIN_PASSWORD: adminPassword,
        SESSION_SECRET: sessionSecret,
      },
    });
  }

  // Fallback: dev mode or legacy non-standalone build
  const prod = existsSync(join(dashboardDir, ".next", "BUILD_ID"));
  const args = prod ? ["run", "start"] : ["run", "dev"];
  return spawn("npm", args, {
    cwd: dashboardDir,
    stdio: "inherit",
    detached: true,
    env: {
      ...process.env,
      PORT: String(DASHBOARD_PORT),
      GATEWAY_URL: `http://127.0.0.1:${GATEWAY_PORT}`,
      ADMIN_PASSWORD: adminPassword,
      SESSION_SECRET: sessionSecret,
    },
  });
}

/**
 * One-time bootstrap so a fresh `npm i -g aigetwey` runs with a single command.
 * Seeds a working config from the example, installs the dashboard's own deps
 * (npm doesn't install nested package node_modules for us), and builds the
 * dashboard if the published .next is absent. Each step is skipped once done, so
 * normal runs pay nothing.
 */
function ensureSetup(): void {
  const configPath = getConfigPath();
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });

  // migrate: copy old config + auth from inside the npm package dir on first run
  if (!existsSync(configPath)) {
    const oldConfig = join(root, "config.yaml");
    const src = existsSync(oldConfig) ? oldConfig : join(root, "config.example.yaml");
    if (existsSync(src)) {
      copyFileSync(src, configPath);
      if (existsSync(oldConfig)) {
        console.log(`  migrated config.yaml → ${configPath}`);
      } else {
        console.log("  seeded config.yaml — add providers via the dashboard or edit it directly.");
      }
    }
  }
  // migrate auth.json + session-secret + usage.sqlite from old data/ dir if present
  for (const f of ["auth.json", "session-secret", "usage.sqlite"]) {
    const dest = join(dataDir, f);
    const old = join(root, "data", f);
    if (!existsSync(old)) continue;
    const shouldCopy = !existsSync(dest)
      || (f === "usage.sqlite" && statSync(dest).size < 8192 && statSync(old).size > statSync(dest).size);
    if (shouldCopy) {
      copyFileSync(old, dest);
      if (f === "usage.sqlite") console.log(`  migrated usage data → ${dest}`);
    }
  }

  if (!existsSync(join(root, "node_modules"))) {
    console.log("  installing gateway dependencies (first run)…");
    execSync("npm install --omit=dev --no-fund --no-audit", { cwd: root, stdio: "inherit" });
  }
  if (existsSync(join(dashboardDir, "package.json"))) {
    const hasStandalone = existsSync(join(dashboardDir, ".next", "standalone", "server.js"));
    if (!hasStandalone && !existsSync(join(dashboardDir, "node_modules"))) {
      console.log("  installing dashboard dependencies (first run)…");
      execSync("npm install --no-fund --no-audit", { cwd: dashboardDir, stdio: "inherit" });
    }
    if (!hasStandalone && !existsSync(join(dashboardDir, ".next", "BUILD_ID"))) {
      console.log("  building dashboard (first run)…");
      execSync("npm run build", { cwd: dashboardDir, stdio: "inherit" });
    }
  }
}

function prompt(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a); }));
}

/**
 * aigetwey-style launch menu. With a TTY (and no --yes), let the operator pick
 * how to run; otherwise honor the flags. "web" opens the browser, "terminal"
 * runs with live logs only, "exit" quits before starting anything.
 */
async function chooseMode(): Promise<"web" | "terminal" | "hide" | "exit"> {
  if (opts.yes || !process.stdin.isTTY) return opts.noBrowser ? "terminal" : "web";
  console.log(
    "\n  aigetwey\n\n" +
      "  [1] Web UI        start + open the dashboard in your browser\n" +
      "  [2] Terminal      start with live logs only (no browser)\n" +
      "  [3] Hide to Tray  run in the background with a tray icon\n" +
      "  [4] Exit\n",
  );
  const c = (await prompt("  choose [1]: ")).trim().toLowerCase();
  if (c === "4" || c === "exit" || c === "q") return "exit";
  if (c === "3" || c === "hide" || c === "tray") return "hide";
  if (c === "2" || c === "terminal") return "terminal";
  return "web"; // default on Enter
}

/**
 * "Hide to Tray": re-launch ourselves detached with --tray (which runs the stack
 * + tray icon and survives the terminal closing), then exit so the background
 * copy claims the ports. Also enables run-on-startup, matching aigetwey.
 */
function hideToTray(): void {
  try { enableAutoStart(); } catch { /* optional */ }
  console.log("\n  starting background process… (tray icon appears in a few seconds)");
  const thisFile = fileURLToPath(import.meta.url);
  // dev mode: thisFile is a .ts source — Node can't run it; use tsx instead.
  const [cmd, args] = thisFile.endsWith(".ts")
    ? ["npx", ["tsx", thisFile, "--tray"]]
    : [process.execPath, [thisFile, "--tray"]];
  const bg = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      AIGETWEY_ADMIN_PASSWORD: adminPassword,
      SESSION_SECRET: sessionSecret,
      AIGETWEY_DATA_DIR: getDataDir(),
      AIGETWEY_CONFIG: getConfigPath(),
    },
  });
  bg.unref();
  console.log(`  aigetwey now running in the background (pid ${bg.pid}).`);
  console.log("  right-click the tray icon → Open Dashboard / Quit. You can close this terminal.\n");
}

async function main(): Promise<void> {
  if (opts.version) {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
    console.log(pkg.version);
    return;
  }
  if (opts.help) {
    console.log(HELP);
    return;
  }

  // background tray process: skip the menu, never open a browser, show the tray.
  const mode = opts.tray ? "tray" : await chooseMode();
  if (mode === "exit") return;

  // Run setup in the foreground (with visible output) so the background process
  // inherits a ready environment — no silent multi-minute npm build in the dark.
  if (mode !== "tray") ensureSetup();

  if (mode === "hide") {
    // Pre-install the tray runtime while we still have a terminal to show progress.
    ensureTrayRuntime();
    hideToTray();
    return;
  }
  const wantBrowser = mode === "web";

  console.log("\n  aigetwey — starting gateway + dashboard\n");

  if (mode === "tray") ensureSetup();

  await ensurePortFree(GATEWAY_PORT, "AIGETWEY_PORT");

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

  await ensurePortFree(DASHBOARD_PORT, "DASHBOARD_PORT");

  const dash = spawnDashboard();
  children.push(dash);
  dash.on("exit", (code) => {
    console.error(`\n  dashboard exited (${code}). shutting down.`);
    shutdown();
    process.exit(code ?? 1);
  });

  // one URL for everything — the gateway reverse-proxies the dashboard. Wait for
  // the dashboard to be READY before opening the browser. Probe it directly on
  // its own port (not through the proxy) and require a non-5xx answer: a proxy
  // hit during boot returns 500 (ECONNREFUSED upstream), which a bare "port up"
  // check would mistake for ready and open the browser into a wall of 500s.
  const appUrl = `http://127.0.0.1:${GATEWAY_PORT}`;
  await waitForGateway(`http://127.0.0.1:${DASHBOARD_PORT}/login`, 30000, (s) => s > 0 && s < 500);
  console.log(`\n  aigetwey   ${appUrl}   (dashboard + API, one URL)`);
  if (generatedPw) {
    console.log(`\n  admin password (generated): ${adminPassword}`);
    console.log("  set AIGETWEY_ADMIN_PASSWORD to keep it stable across runs.\n");
  }
  if (mode === "tray") {
    ensureTrayRuntime({ silent: false });
    const started = initTray({ dashboardUrl: appUrl, port: GATEWAY_PORT, onQuit: shutdown });
    console.log(
      started
        ? "\n  running in the system tray — right-click the icon for Open Dashboard / Quit.\n"
        : "\n  (tray unavailable on this session — running in the background; Ctrl-C or kill to stop.)\n",
    );
  } else if (wantBrowser) {
    openBrowser(appUrl);
  } else {
    console.log(`  (terminal mode — open ${appUrl} when you want the dashboard)\n`);
  }
}

main().catch((e) => {
  console.error(e);
  shutdown();
  process.exit(1);
});
