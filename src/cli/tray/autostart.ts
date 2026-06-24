/**
 * Run-on-OS-startup, toggled from the tray menu. Ported from 9router's
 * autostart, retargeted at the aigetwey CLI launched with `--tray`.
 *
 *   macOS  → ~/Library/LaunchAgents/com.aigetwey.autostart.plist (launchd)
 *   Windows→ %APPDATA%/.../Startup/aigetwey.vbs
 *   Linux  → ~/.config/autostart/aigetwey.desktop
 */
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const APP_NAME = "aigetwey";
const APP_LABEL = "com.aigetwey.autostart";
const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the launcher script (dist/cli.js). */
function getCliPath(explicit?: string): string | null {
  if (explicit && existsSync(resolve(explicit))) return resolve(explicit);
  if (process.argv[1]) {
    const r = resolve(process.argv[1]);
    if (/cli\.(js|ts)$/.test(basename(r)) && existsSync(r)) return r;
  }
  // dist/cli/tray/autostart.js → up two → dist/cli.js
  const computed = resolve(here, "..", "..", "cli.js");
  return existsSync(computed) ? computed : null;
}

export function isAutoStartEnabled(): boolean {
  try {
    if (process.platform === "darwin") {
      const plist = join(homedir(), "Library", "LaunchAgents", `${APP_LABEL}.plist`);
      return existsSync(plist);
    }
    if (process.platform === "win32") {
      return existsSync(join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", `${APP_NAME}.vbs`));
    }
    return existsSync(join(homedir(), ".config", "autostart", `${APP_NAME}.desktop`));
  } catch {
    return false;
  }
}

export function enableAutoStart(cliPath?: string): boolean {
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
  const script = getCliPath(cliPath);
  if (!script) return false;
  const node = process.execPath;
  try {
    if (process.platform === "darwin") return enableMac(node, script);
    if (process.platform === "win32") return enableWin(node, script);
    return enableLinux(node, script);
  } catch {
    return false;
  }
}

export function disableAutoStart(): boolean {
  try {
    if (process.platform === "darwin") return disableMac();
    if (process.platform === "win32") return disableWin();
    return disableLinux();
  } catch {
    return false;
  }
}

// ── macOS ──
function enableMac(node: string, script: string): boolean {
  const dir = join(homedir(), "Library", "LaunchAgents");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const plistPath = join(dir, `${APP_LABEL}.plist`);
  const path = `${dirname(node)}:/usr/local/bin:/usr/bin:/bin`;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${APP_LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${node}</string><string>${script}</string><string>--tray</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${path}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict></plist>`;
  writeFileSync(plistPath, plist);
  try { execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" }); } catch { /* not loaded */ }
  try { execSync(`launchctl load -w "${plistPath}"`, { stdio: "ignore" }); } catch { /* picked up next login */ }
  return true;
}
function disableMac(): boolean {
  const plistPath = join(homedir(), "Library", "LaunchAgents", `${APP_LABEL}.plist`);
  try { execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" }); } catch { /* not loaded */ }
  if (existsSync(plistPath)) unlinkSync(plistPath);
  return true;
}

// ── Windows ──
function enableWin(node: string, script: string): boolean {
  const dir = join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
  if (!existsSync(dir)) return false;
  const vbs = `Set WshShell = CreateObject("WScript.Shell")\nWshShell.Run """${node}"" ""${script}"" --tray", 0, False\n`;
  writeFileSync(join(dir, `${APP_NAME}.vbs`), vbs);
  return true;
}
function disableWin(): boolean {
  const vbs = join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", `${APP_NAME}.vbs`);
  if (existsSync(vbs)) unlinkSync(vbs);
  return true;
}

// ── Linux ──
function enableLinux(node: string, script: string): boolean {
  const dir = join(homedir(), ".config", "autostart");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const desktop = `[Desktop Entry]
Type=Application
Name=aigetwey
Comment=Personal AI gateway
Exec=${node} ${script} --tray
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
`;
  writeFileSync(join(dir, `${APP_NAME}.desktop`), desktop);
  return true;
}
function disableLinux(): boolean {
  const desktop = join(homedir(), ".config", "autostart", `${APP_NAME}.desktop`);
  if (existsSync(desktop)) unlinkSync(desktop);
  return true;
}
