/**
 * Headroom proxy lifecycle — start/stop the external `headroom proxy` as a
 * detached child of the gateway, tracked by a PID file under the data dir.
 *
 * Ported from 9router (src/lib/headroom/process.js). See [[replicate-9router-fully]].
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { findHeadroomBinary } from "./detect.js";

const DATA_DIR = path.resolve(process.env.AIGETWEY_DATA_DIR ?? "data");
const HEADROOM_DIR = path.join(DATA_DIR, "headroom");
const PID_FILE = path.join(HEADROOM_DIR, "proxy.pid");
const LOG_FILE = path.join(HEADROOM_DIR, "proxy.log");
const DEFAULT_PORT = 8787;
const STARTUP_TIMEOUT_MS = 8000;

interface CodedError extends Error {
  code?: string;
}

function ensureDir(): void {
  if (!fs.existsSync(HEADROOM_DIR)) fs.mkdirSync(HEADROOM_DIR, { recursive: true });
}

function readPid(): number | null {
  try {
    if (fs.existsSync(PID_FILE)) return parseInt(fs.readFileSync(PID_FILE, "utf8"), 10);
  } catch {
    /* ignore */
  }
  return null;
}

function writePid(pid: number): void {
  ensureDir();
  fs.writeFileSync(PID_FILE, String(pid));
}

function clearPid(): void {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
}

/** process.kill(pid, 0) throws if the pid is dead — use it to probe liveness. */
export function isPidAlive(pid: number | null): boolean {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getManagedPid(): number | null {
  const pid = readPid();
  return pid && isPidAlive(pid) ? pid : null;
}

export async function startHeadroomProxy({ port = DEFAULT_PORT }: { port?: number } = {}): Promise<{
  pid: number;
  alreadyRunning: boolean;
}> {
  const safePort = Number(port) > 0 && Number(port) < 65536 ? Number(port) : DEFAULT_PORT;
  const binary = findHeadroomBinary();
  if (!binary) {
    const err: CodedError = new Error("Headroom CLI not installed");
    err.code = "NOT_INSTALLED";
    throw err;
  }

  const existing = getManagedPid();
  if (existing) return { pid: existing, alreadyRunning: true };

  ensureDir();
  // spawn stdio requires fd numbers, not WriteStream objects.
  const outFd = fs.openSync(LOG_FILE, "a");

  const child = spawn(binary, ["proxy", "--port", String(safePort)], {
    stdio: ["ignore", outFd, outFd],
    detached: true,
    windowsHide: true,
    env: { ...process.env },
  });

  if (!child.pid) {
    fs.closeSync(outFd);
    const err: CodedError = new Error("Failed to spawn headroom proxy");
    err.code = "SPAWN_FAILED";
    throw err;
  }

  child.unref();
  writePid(child.pid);

  // Wait until the process either stays alive briefly (success) or exits fast (failure).
  await new Promise<void>((resolve, reject) => {
    const startupTimer = setTimeout(() => {
      if (isPidAlive(child.pid ?? null)) resolve();
      else reject(new Error("headroom proxy exited during startup — see proxy.log"));
    }, STARTUP_TIMEOUT_MS);

    child.once("exit", (code) => {
      clearTimeout(startupTimer);
      clearPid();
      try {
        fs.closeSync(outFd);
      } catch {
        /* already closed */
      }
      const e: CodedError = new Error(`headroom proxy exited early (code=${code}) — see proxy.log`);
      e.code = "EARLY_EXIT";
      reject(e);
    });
  });

  // Close parent's copy of the fd; child retains its own after unref.
  try {
    fs.closeSync(outFd);
  } catch {
    /* already closed */
  }

  return { pid: child.pid, alreadyRunning: false };
}

export function stopHeadroomProxy(): { stopped: boolean; reason?: string; pid?: number } {
  const pid = getManagedPid();
  if (!pid) return { stopped: false, reason: "not_running" };
  try {
    process.kill(pid, "SIGTERM");
    // Give it a moment, then force if still alive.
    setTimeout(() => {
      if (isPidAlive(pid)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }, 2000);
    clearPid();
    return { stopped: true, pid };
  } catch (e) {
    clearPid();
    const err: CodedError = new Error(`Failed to stop headroom proxy: ${(e as Error).message}`);
    err.code = "STOP_FAILED";
    throw err;
  }
}

export function getHeadroomLogTail(maxLines = 200): string {
  try {
    if (!fs.existsSync(LOG_FILE)) return "";
    const content = fs.readFileSync(LOG_FILE, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}
