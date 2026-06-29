import type { UsageDB, NotificationConfigRow } from "../db.js";

export type AlertEventType = "budget_alert" | "budget_exceeded";

export interface AlertPayload {
  type: AlertEventType;
  scope: string;
  label: string;
  message: string;
  spent: number;
  limit: number;
  unit: "usd" | "tokens";
  pct: number;
  note?: string;
}

function fmtAmount(v: number, unit: string): string {
  return unit === "usd" ? `$${v.toFixed(2)}` : `${v.toLocaleString()} tokens`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function sendToChannel(cfg: NotificationConfigRow, payload: AlertPayload): Promise<void> {
  async function post(url: string, headers: Record<string, string>, body: string): Promise<void> {
    const res = await fetch(url, { method: "POST", headers, body });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`${url} → HTTP ${res.status} ${detail.slice(0, 200)}`);
    }
  }

  const pctStr = Math.round(payload.pct * 100);
  const spentStr = fmtAmount(payload.spent, payload.unit);
  const limitStr = fmtAmount(payload.limit, payload.unit);
  const title = payload.type === "budget_exceeded" ? "Budget Exceeded" : "Budget Alert";
  const ts = fmtTime(Date.now());

  switch (cfg.id) {
    case "webhook":
      await post(cfg.url, { "Content-Type": "application/json" }, JSON.stringify({
        type: payload.type,
        scope: payload.scope,
        label: payload.label,
        spent: payload.spent,
        limit: payload.limit,
        unit: payload.unit,
        percentage: pctStr,
        note: payload.note ?? "",
        message: payload.message,
        ts: Date.now(),
      }));
      break;

    case "telegram": {
      const lines = [
        `🚨 <b>${title}</b>`,
        "",
        `<b>${payload.label}</b>`,
        `Spent: <code>${spentStr}</code> / <code>${limitStr}</code> (<code>${pctStr}%</code>)`,
      ];
      if (payload.note) lines.push(`Note: ${payload.note}`);
      lines.push("", `<i>aigloo · ${ts}</i>`);
      await post(
        `https://api.telegram.org/bot${cfg.token}/sendMessage`,
        { "Content-Type": "application/json" },
        JSON.stringify({ chat_id: cfg.chat_id, text: lines.join("\n"), parse_mode: "HTML" }),
      );
      break;
    }

    case "discord": {
      const color = payload.type === "budget_exceeded" ? 0xff0000 : 0xff9900;
      const fields = [
        { name: "Spent", value: spentStr, inline: true },
        { name: "Limit", value: limitStr, inline: true },
        { name: "Usage", value: `${pctStr}%`, inline: true },
      ];
      if (payload.note) fields.push({ name: "Note", value: payload.note, inline: false });
      await post(
        cfg.url,
        { "Content-Type": "application/json" },
        JSON.stringify({
          embeds: [{
            title: `🚨 ${title}`,
            description: payload.label,
            color,
            fields,
            footer: { text: `aigloo · ${ts}` },
          }],
        }),
      );
      break;
    }
  }
}

export class Notifier {
  constructor(private readonly db: UsageDB) {}

  async send(payload: AlertPayload): Promise<void> {
    const configs = this.db.listNotificationConfigs().filter(
      (c) => c.enabled && c.events.includes(payload.type),
    );
    if (configs.length === 0) return;

    for (const cfg of configs) {
      try {
        await sendToChannel(cfg, payload);
        this.db.logAlert(payload.type, payload.scope, cfg.id, payload.message, true);
      } catch (e) {
        this.db.logAlert(payload.type, payload.scope, cfg.id, payload.message, false, (e as Error).message);
      }
    }
  }

  async test(channelId: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = this.db.getNotificationConfig(channelId);
    if (!cfg) return { ok: false, error: "channel not configured" };
    if (!cfg.enabled) return { ok: false, error: "channel disabled" };
    const testPayload: AlertPayload = {
      type: "budget_alert",
      scope: "test",
      label: "Test Budget",
      message: "Test notification from aigloo — notifications are working.",
      spent: 8.50,
      limit: 10.00,
      unit: "usd",
      pct: 0.85,
    };
    try {
      await sendToChannel(cfg, testPayload);
      this.db.logAlert("budget_alert", "test", channelId, testPayload.message, true);
      return { ok: true };
    } catch (e) {
      this.db.logAlert("budget_alert", "test", channelId, testPayload.message, false, (e as Error).message);
      return { ok: false, error: (e as Error).message };
    }
  }
}
