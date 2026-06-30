"use client";

import { useEffect, useState, useCallback } from "react";
import { RichCard, CardTitle } from "@/components/RichCard";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { LoadingDots } from "@/components/ui";
import { adminApi } from "@/lib/client";
import type { NotificationConfig, AlertLogEntry } from "@/lib/gateway";

const CHANNELS = [
  {
    id: "webhook",
    name: "Webhook",
    icon: "webhook",
    fields: [{ key: "url", label: "URL", placeholder: "https://hooks.slack.com/services/...", type: "text" }],
    blurb: "POST JSON to any URL — Slack, Zapier, n8n, etc.",
  },
  {
    id: "telegram",
    name: "Telegram",
    icon: "send",
    fields: [
      { key: "token", label: "Bot Token", placeholder: "123456:ABC-DEF...", type: "password" },
      { key: "chat_id", label: "Chat ID", placeholder: "-1001234567890", type: "text" },
    ],
    blurb: "Send via Telegram Bot API.",
  },
  {
    id: "discord",
    name: "Discord",
    icon: "forum",
    fields: [{ key: "url", label: "Webhook URL", placeholder: "https://discord.com/api/webhooks/...", type: "text" }],
    blurb: "POST to a Discord channel webhook.",
  },
] as const;

const EVENTS = [
  { id: "budget_alert", label: "Budget alert (threshold reached)" },
  { id: "budget_exceeded", label: "Budget exceeded (hard stop)" },
];

export function NotificationsView() {
  const [configs, setConfigs] = useState<Record<string, NotificationConfig>>({});
  const [alerts, setAlerts] = useState<AlertLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string>("");
  const [testing, setTesting] = useState<string>("");
  const [msg, setMsg] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await adminApi.notifications();
    if (r.ok && r.data) {
      const map: Record<string, NotificationConfig> = {};
      for (const c of r.data.configs) map[c.id] = c;
      setConfigs(map);
      setAlerts(r.data.alerts);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function getCfg(id: string): NotificationConfig {
    return configs[id] ?? { id, enabled: false, url: "", token: "", chat_id: "", events: [], updated_at: 0 };
  }

  function patch(id: string, p: Partial<NotificationConfig>) {
    setConfigs((prev) => {
      const existing = prev[id] ?? { id, enabled: false, url: "", token: "", chat_id: "", events: [], updated_at: 0 };
      return { ...prev, [id]: { ...existing, ...p } };
    });
  }

  async function save(id: string) {
    const cfg = getCfg(id);
    setSaving(id);
    setMsg((m) => ({ ...m, [id]: "" }));
    const r = await adminApi.setNotification(id, {
      enabled: cfg.enabled,
      url: cfg.url,
      token: cfg.token,
      chat_id: cfg.chat_id,
      events: cfg.events,
    });
    setSaving("");
    setMsg((m) => ({ ...m, [id]: r.ok ? "Saved ✓" : r.error ?? "failed" }));
    if (r.ok) setTimeout(() => setMsg((m) => ({ ...m, [id]: "" })), 2000);
  }

  async function toggleEnabled(id: string) {
    const cfg = getCfg(id);
    const next = { ...cfg, enabled: !cfg.enabled };
    patch(id, { enabled: next.enabled });
    setSaving(id);
    setMsg((m) => ({ ...m, [id]: "" }));
    const r = await adminApi.setNotification(id, {
      enabled: next.enabled,
      url: next.url,
      token: next.token,
      chat_id: next.chat_id,
      events: next.events,
    });
    setSaving("");
    setMsg((m) => ({ ...m, [id]: r.ok ? (next.enabled ? "Enabled ✓" : "Disabled ✓") : r.error ?? "failed" }));
    if (r.ok) setTimeout(() => setMsg((m) => ({ ...m, [id]: "" })), 2000);
  }

  async function test(id: string) {
    setTesting(id);
    setMsg((m) => ({ ...m, [id]: "" }));
    const r = await adminApi.testNotification(id);
    setTesting("");
    setMsg((m) => ({ ...m, [id]: r.ok ? "Test sent ✓" : r.error ?? "failed" }));
    setTimeout(() => setMsg((m) => ({ ...m, [id]: "" })), 3000);
  }

  function toggleEvent(id: string, eventId: string) {
    const cfg = getCfg(id);
    const has = cfg.events.includes(eventId);
    patch(id, { events: has ? cfg.events.filter((e) => e !== eventId) : [...cfg.events, eventId] });
  }

  if (loading) return <LoadingDots />;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[30px] font-bold tracking-tight heading-gradient heading-accent">Notifications</h1>
        <p className="mt-1 text-[13px] text-text-muted">Get alerted when budgets hit their threshold or run out.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {CHANNELS.map((ch) => {
          const cfg = getCfg(ch.id);
          return (
            <RichCard
              key={ch.id}
              header={
                <>
                  <CardTitle
                    title={ch.name}
                    icon={<span className="flex h-8 w-8 items-center justify-center rounded-brand bg-surface-2 text-text-muted"><Icon name={ch.icon} size={18} /></span>}
                  />
                  <button
                    type="button"
                    onClick={() => void toggleEnabled(ch.id)}
                    disabled={saving === ch.id}
                    className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${cfg.enabled ? "bg-accent" : "bg-surface-3"}`}
                    aria-label={cfg.enabled ? "disable" : "enable"}
                  >
                    <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${cfg.enabled ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </>
              }
              footer={
                <>
                  <div className="flex items-center gap-2">
                    <Button onClick={() => save(ch.id)} disabled={saving === ch.id} className="px-3 py-1.5 text-[12px]">
                      <Icon name={saving === ch.id ? "progress_activity" : "save"} size={14} />
                      {saving === ch.id ? "Saving…" : "Save"}
                    </Button>
                    <Button variant="ghost" onClick={() => test(ch.id)} disabled={testing === ch.id || !cfg.enabled} className="px-3 py-1.5 text-[12px]">
                      <Icon name={testing === ch.id ? "progress_activity" : "send"} size={14} />
                      {testing === ch.id ? "Sending…" : "Test"}
                    </Button>
                  </div>
                  {msg[ch.id] && <span className="text-[12px] text-text-subtle">{msg[ch.id]}</span>}
                </>
              }
            >
              <p className="mb-3 text-[12px] text-text-subtle">{ch.blurb}</p>

              <div className="space-y-2.5">
                {ch.fields.map((f) => (
                  <div key={f.key}>
                    <label className="mb-1 block text-[11px] font-medium text-text-subtle">{f.label}</label>
                    <input
                      type={f.type}
                      value={f.key === "url" ? cfg.url : f.key === "token" ? cfg.token : cfg.chat_id}
                      onChange={(e) => patch(ch.id, { [f.key]: e.target.value })}
                      placeholder={f.placeholder}
                      className="w-full rounded-brand border border-border bg-bg px-3 py-2 text-[13px] text-text placeholder:text-text-subtle focus:border-accent focus:outline-none transition-colors"
                    />
                  </div>
                ))}
              </div>

              <div className="mt-4 space-y-2">
                <span className="text-[11px] font-medium text-text-subtle">Events</span>
                {EVENTS.map((ev) => {
                  const checked = cfg.events.includes(ev.id);
                  return (
                    <label key={ev.id} className="flex cursor-pointer items-center gap-2 text-[12px] text-text-muted">
                      <span className={`flex h-4 w-4 items-center justify-center rounded-[5px] border transition-all ${checked ? "border-accent bg-accent" : "border-border bg-surface-2"}`}>
                        {checked && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-ink)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                      <input type="checkbox" checked={checked} onChange={() => toggleEvent(ch.id, ev.id)} className="sr-only" />
                      {ev.label}
                    </label>
                  );
                })}
              </div>
            </RichCard>
          );
        })}
      </div>

      <div className="mt-6">
        <h2 className="mb-3 text-[16px] font-bold text-text">Recent Alerts</h2>
        {alerts.length === 0 ? (
          <div className="card rounded-brand-lg p-6 text-center text-[13px] text-text-subtle">
            No alerts yet. Alerts appear here when a budget crosses its threshold.
          </div>
        ) : (
          <div className="card overflow-hidden rounded-brand-lg">
            {alerts.map((a, i) => (
              <div key={a.id} className={`flex items-center gap-3 px-4 py-2.5 ${i > 0 ? "border-t border-border-subtle" : ""}`}>
                <Icon name={a.type === "budget_exceeded" ? "error" : "warning"} size={16} className={a.delivered ? "text-warning" : "text-danger"} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-text">{a.message}</div>
                  <div className="text-[11px] text-text-subtle">
                    {new Date(a.ts).toLocaleString()}{a.channel ? ` · ${a.channel}` : ""} · {a.scope}
                    {!a.delivered && a.error ? ` · ${a.error}` : ""}
                  </div>
                </div>
                <Badge tone={a.delivered ? "live" : "danger"}>
                  {a.delivered ? "delivered" : "failed"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
