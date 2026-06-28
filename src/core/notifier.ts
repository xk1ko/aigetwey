/**
 * Fire-and-forget notification sender. Three channels: generic webhook,
 * Telegram Bot API, Discord webhook. Each channel is independently configured
 * in the notifications SQLite table; send() reads configs, filters by event
 * type, and POSTs to every matching channel. Failures are logged to alert_log
 * but never thrown — the request that triggered the alert must not fail.
 */
import type { UsageDB, NotificationConfigRow } from "../db.js";

export type AlertEventType = "budget_alert" | "budget_exceeded";

export interface AlertPayload {
  type: AlertEventType;
  scope: string;
  message: string;
}

async function sendToChannel(cfg: NotificationConfigRow, payload: AlertPayload): Promise<void> {
  const body = JSON.stringify({
    type: payload.type,
    scope: payload.scope,
    message: payload.message,
    ts: Date.now(),
  });

  switch (cfg.id) {
    case "webhook":
      await fetch(cfg.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      break;

    case "telegram": {
      const text = `🚨 <b>${payload.type === "budget_exceeded" ? "Budget Exceeded" : "Budget Alert"}</b>\n${payload.message}`;
      await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: cfg.chat_id, text, parse_mode: "HTML" }),
      });
      break;
    }

    case "discord":
      await fetch(cfg.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `🚨 **${payload.type === "budget_exceeded" ? "Budget Exceeded" : "Budget Alert"}**\n${payload.message}` }),
      });
      break;
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
        this.db.logAlert(payload.type, payload.scope, payload.message, true);
      } catch (e) {
        this.db.logAlert(payload.type, payload.scope, payload.message, false, (e as Error).message);
      }
    }
  }

  async test(channelId: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = this.db.getNotificationConfig(channelId);
    if (!cfg) return { ok: false, error: "channel not configured" };
    if (!cfg.enabled) return { ok: false, error: "channel disabled" };
    try {
      await sendToChannel(cfg, {
        type: "budget_alert",
        scope: "test",
        message: "Test notification from aigloo gateway — notifications are working.",
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
