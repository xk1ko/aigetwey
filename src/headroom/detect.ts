/**
 * Headroom CLI detection. "Headroom" is an external context-compression proxy
 * (a Python tool, `headroom proxy`, default http://localhost:8787) that aigetwey
 * pipes request messages through. This module only DETECTS it — install, python
 * interpreter, and whether a proxy is already reachable.
 *
 * Ported from 9router (src/lib/headroom/detect.js). See [[replicate-9router-fully]].
 */
import { execSync } from "node:child_process";
import { delimiter } from "node:path";

const IS_WIN = process.platform === "win32";
const WHICH_CMD = IS_WIN ? "where" : "which";

// Extra bin dirs often missing from a packaged PATH (Python installs headroom here).
const EXTRA_BINS = IS_WIN
  ? [
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python313\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python312\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python311\\Scripts`,
      `${process.env.APPDATA || ""}\\Python\\Python313\\Scripts`,
    ]
  : [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      `${process.env.HOME || ""}/.local/bin`,
      "/usr/bin",
      "/bin",
    ];

const EXTENDED_PATH = [...EXTRA_BINS, process.env.PATH || ""].filter(Boolean).join(delimiter);
const PYTHON_CANDIDATES = ["python3.13", "python3.12", "python3.11", "python3.10", "python3", "python"];
const MIN_VERSION: [number, number] = [3, 10];
const HEADROOM_HEALTH_TIMEOUT_MS = 1500;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

export const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

export interface HeadroomStatus {
  installed: boolean;
  path: string | null;
  running: boolean;
  python: string | null;
  localUrl: boolean;
  canStart: boolean;
}

/** Locate the `headroom` binary, or null if not installed. */
export function findHeadroomBinary(): string | null {
  try {
    const out = execSync(`${WHICH_CMD} headroom`, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
    })
      .toString()
      .trim();
    // Windows `where` may return multiple lines — take the first.
    return out ? (out.split(/\r?\n/)[0] ?? "").trim() || null : null;
  } catch {
    return null;
  }
}

/** Find a Python interpreter >= 3.10 (headroom-ai requires it), or null. */
export function findPython310(): string | null {
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      const ver = execSync(`${candidate} --version`, {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        env: { ...process.env, PATH: EXTENDED_PATH },
      })
        .toString()
        .trim();
      const match = ver.match(/(\d+)\.(\d+)/);
      if (!match) continue;
      const major = parseInt(match[1]!, 10);
      const minor = parseInt(match[2]!, 10);
      if (major > MIN_VERSION[0] || (major === MIN_VERSION[0] && minor >= MIN_VERSION[1])) {
        return candidate;
      }
    } catch {
      // candidate not present, try next
    }
  }
  return null;
}

/** Probe a Headroom proxy's /health. */
export async function probeProxyRunning(url: string): Promise<boolean> {
  if (!url) return false;
  const base = String(url).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(HEADROOM_HEALTH_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

export function isLoopbackHeadroomUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/** Aggregate status for the dashboard: installed, running, python interpreter. */
export async function getHeadroomStatus(url: string): Promise<HeadroomStatus> {
  const path = findHeadroomBinary();
  const python = findPython310();
  const installed = Boolean(path);
  const running = await probeProxyRunning(url);
  const localUrl = isLoopbackHeadroomUrl(url);
  return { installed, path, running, python, localUrl, canStart: installed && localUrl };
}
