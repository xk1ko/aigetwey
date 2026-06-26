#!/usr/bin/env node
// Pre-install the system tray runtime right after npm install so the first
// `aigetwey` launch is instant. Non-fatal — gateway still works without tray.
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const SYSTRAY_PKG = "systray2";
const SYSTRAY_VERSION = "2.1.4";

function getRuntimeDir() {
  const base = process.platform === "win32" ? (process.env.APPDATA || os.homedir()) : os.homedir();
  const name = process.platform === "win32" ? "aigetwey" : ".aigetwey";
  return path.join(base, name, "runtime");
}

function getRuntimeNodeModules() {
  return path.join(getRuntimeDir(), "node_modules");
}

function hasSystray() {
  return fs.existsSync(path.join(getRuntimeNodeModules(), SYSTRAY_PKG, "package.json"));
}

function chmodTrayBin() {
  const binName = process.platform === "darwin" ? "tray_darwin_release" : "tray_linux_release";
  const p = path.join(getRuntimeNodeModules(), SYSTRAY_PKG, "traybin", binName);
  try { if (fs.existsSync(p)) fs.chmodSync(p, 0o755); } catch {}
}

function ensureRuntimeDir() {
  const dir = getRuntimeDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const pkg = path.join(dir, "package.json");
  if (!fs.existsSync(pkg)) {
    fs.writeFileSync(pkg, JSON.stringify({ name: "aigetwey-runtime", version: "1.0.0", private: true }, null, 2));
  }
  return dir;
}

// Windows uses PowerShell NotifyIcon — no Go binary needed.
if (process.platform === "win32") process.exit(0);
// Skip in headless environments.
if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) process.exit(0);

if (hasSystray()) {
  chmodTrayBin();
  process.exit(0);
}

const cwd = ensureRuntimeDir();
console.log("[aigetwey] installing system tray runtime…");
const res = spawnSync(
  "npm",
  ["install", `${SYSTRAY_PKG}@${SYSTRAY_VERSION}`, "--no-save", "--no-audit", "--no-fund"],
  { cwd, stdio: "inherit", timeout: 120_000 },
);
if (res.status !== 0) {
  console.warn("[aigetwey] tray runtime install failed — tray unavailable (gateway still works).");
} else {
  chmodTrayBin();
  console.log("[aigetwey] system tray ready.");
}
process.exit(0);
