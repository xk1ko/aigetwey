/**
 * Windows system tray via PowerShell NotifyIcon. No native binary needed —
 * uses the .NET System.Windows.Forms.NotifyIcon available on every Windows
 * install. A long-running PowerShell process hosts the icon + menu and
 * communicates via stdout (menu-click events).
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { TRAY_ICON_ICO_BASE64 } from "./icon.js";

interface WinTrayConfig {
  tooltip: string;
  items: Array<{ title: string; tooltip: string; enabled: boolean }>;
  onClick: (index: number) => void;
}

interface WinTrayHandle {
  kill(): void;
  updateItem(i: number, title: string, enabled: boolean): void;
}

export function initWinTray(cfg: WinTrayConfig): WinTrayHandle {
  const tooltip = cfg.tooltip.replace(/"/g, '`"');
  const itemsJson = JSON.stringify(cfg.items.map((it) => ({ title: it.title, enabled: it.enabled })));
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$icon = [System.Convert]::FromBase64String("${TRAY_ICON_ICO_BASE64}")
$ms = New-Object System.IO.MemoryStream(,$icon)
$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon = New-Object System.Drawing.Icon($ms)
$ni.Visible = $true
$ni.Text = "${tooltip}"
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$items = @()
${itemsJson} | ForEach-Object {
  $item = $menu.Items.Add($_.title)
  $item.Enabled = $_.enabled
  $item.Tag = $items.Count
  $items += $item
  $item.add_Click({
    param($s)
    Write-Output $s.Tag
    [Console]::Out.Flush()
  })
}
$ni.ContextMenuStrip = $menu
while ($true) { Start-Sleep -Milliseconds 200 }
`;

  const proc: ChildProcessWithoutNullStreams = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true },
  );

  let buffer = "";
  proc.stdout.on("data", (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && /^\d+$/.test(trimmed)) {
        cfg.onClick(parseInt(trimmed, 10));
      }
    }
  });

  proc.stderr.on("data", (data: Buffer) => {
    process.stderr.write(`[tray-win] ${data}`);
  });

  return {
    kill() {
      try {
        proc.kill();
      } catch { /* gone */ }
    },
    updateItem(i: number, title: string, enabled: boolean) {
      // PowerShell doesn't support live menu updates without IPC; re-launch
      // is overkill for the autostart toggle — the menu refreshes on next start.
    },
  };
}
