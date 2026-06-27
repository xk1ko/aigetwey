import { existsSync, mkdirSync, createWriteStream, chmodSync, statSync, openSync, readSync, closeSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { platform, arch, tmpdir } from "node:os";
import { getDataDir } from "../appDirs.js";

const BIN_DIR = join(getDataDir(), "bin");
const IS_WIN = platform() === "win32";
const BIN_NAME = IS_WIN ? "cloudflared.exe" : "cloudflared";
const BIN_PATH = join(BIN_DIR, BIN_NAME);

const GITHUB_BASE = "https://github.com/cloudflare/cloudflared/releases/latest/download";
const PLATFORM_MAP: Record<string, Record<string, string>> = {
  darwin: { x64: "cloudflared-darwin-amd64.tgz", arm64: "cloudflared-darwin-arm64.tgz" },
  win32: { x64: "cloudflared-windows-amd64.exe", arm64: "cloudflared-windows-386.exe" },
  linux: { x64: "cloudflared-linux-amd64", arm64: "cloudflared-linux-arm64" },
};

function getDownloadUrl(): string {
  const m = PLATFORM_MAP[platform()];
  if (!m) throw new Error(`unsupported platform: ${platform()}`);
  return `${GITHUB_BASE}/${m[arch()] ?? Object.values(m)[0]}`;
}

function isValidBinary(): boolean {
  if (!existsSync(BIN_PATH)) return false;
  try {
    const size = statSync(BIN_PATH).size;
    if (size < 1_000_000) return false;
    const fd = openSync(BIN_PATH, "r");
    const buf = Buffer.alloc(4);
    readSync(fd, buf, 0, 4, 0);
    closeSync(fd);
    const magic = buf.toString("hex");
    if (platform() === "linux") return magic.startsWith("7f454c46");
    if (platform() === "darwin") return magic.startsWith("cffaedfe") || magic.startsWith("cefaedfe");
    if (IS_WIN) return magic.startsWith("4d5a");
    return true;
  } catch { return false; }
}

async function download(url: string, dest: string): Promise<void> {
  const { default: { request } } = await import("undici");
  let finalUrl = url;
  // Follow redirects manually (undici may not support maxRedirections)
  for (let i = 0; i < 5; i++) {
    const res = await request(finalUrl, { method: "GET" });
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      finalUrl = res.headers.location as string;
      continue;
    }
    if (res.statusCode !== 200) throw new Error(`download failed: ${res.statusCode}`);
    const ws = createWriteStream(dest);
    for await (const chunk of res.body) ws.write(chunk);
    ws.end();
    await new Promise<void>((resolve, reject) => { ws.on("finish", resolve); ws.on("error", reject); });
    return;
  }
  throw new Error("too many redirects");
}

export async function ensureCloudflared(): Promise<string> {
  mkdirSync(BIN_DIR, { recursive: true });
  if (isValidBinary()) return BIN_PATH;

  const url = getDownloadUrl();
  const isArchive = url.endsWith(".tgz");
  const tmp = join(BIN_DIR, isArchive ? "cloudflared.tgz.tmp" : "cloudflared.tmp");

  if (existsSync(tmp)) unlinkSync(tmp);
  await download(url, tmp);

  if (isArchive) {
    execSync(`tar -xzf "${tmp}" -C "${BIN_DIR}"`, { stdio: "pipe" });
    unlinkSync(tmp);
  } else {
    const { renameSync } = await import("node:fs");
    renameSync(tmp, BIN_PATH);
  }

  if (!IS_WIN) chmodSync(BIN_PATH, "755");
  return BIN_PATH;
}

// --- spawn quick tunnel ---

let proc: ChildProcess | null = null;
let currentUrl: string | null = null;
let intentionalKill = false;

export function getTunnelUrl(): string | null { return currentUrl; }
export function isTunnelRunning(): boolean { return proc !== null; }

export async function startQuickTunnel(localPort: number): Promise<string> {
  if (proc) {
    if (currentUrl) return currentUrl;
    throw new Error("tunnel already starting");
  }

  const bin = await ensureCloudflared();
  const child = spawn(bin, ["tunnel", "--url", `http://127.0.0.1:${localPort}`, "--no-autoupdate"], {
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
    cwd: tmpdir(),
  });
  proc = child;

  return new Promise<string>((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) { resolved = true; reject(new Error("tunnel timed out (90s)")); }
    }, 90_000);

    function parse(data: Buffer) {
      const msg = data.toString();
      const match = msg.match(/https:\/\/([a-z0-9-]+)\.trycloudflare\.com/i);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        currentUrl = match[0];
        resolve(match[0]);
      }
    }

    child.stdout!.on("data", parse);
    child.stderr!.on("data", parse);

    child.on("error", (err) => {
      if (!resolved) { resolved = true; clearTimeout(timeout); reject(err); }
    });

    child.on("exit", (code) => {
      proc = null;
      if (!intentionalKill) currentUrl = null;
      intentionalKill = false;
      if (!resolved) { resolved = true; clearTimeout(timeout); reject(new Error(`cloudflared exited (code ${code})`)); }
    });
  });
}

export function stopTunnel(): void {
  if (!proc) return;
  intentionalKill = true;
  proc.kill();
  proc = null;
  currentUrl = null;
}
