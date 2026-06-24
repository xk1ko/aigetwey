"use client";

import { useState } from "react";
import { RichCard, CardTitle } from "@/components/RichCard";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { account } from "@/lib/client";

/**
 * Change the admin password (used for the dashboard login and the gateway's
 * /admin API). The gateway verifies the current password and stores the new one
 * hashed; this browser's session is refreshed so you stay logged in.
 */
export function PasswordEditor() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function save() {
    setErr("");
    setMsg("");
    if (next !== confirm) {
      setErr("new password and confirmation don't match");
      return;
    }
    if (next.length < 4) {
      setErr("new password must be at least 4 characters");
      return;
    }
    setBusy(true);
    const r = await account.changePassword(current, next);
    setBusy(false);
    if (!r.ok) {
      setErr(r.error ?? "could not change password");
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setMsg("Password changed ✓ — it's active now.");
  }

  const field = "w-full max-w-[280px] rounded-brand border border-border bg-bg px-2.5 py-1.5 text-[13px] text-text focus:border-accent focus:outline-none";

  return (
    <RichCard header={<CardTitle title="Admin password" sub="for the dashboard login + the gateway admin API" />}>
      <div className="space-y-2.5">
        <Row label="Current">
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className={field} autoComplete="current-password" />
        </Row>
        <Row label="New">
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} className={field} autoComplete="new-password" />
        </Row>
        <Row label="Confirm">
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} autoComplete="new-password" />
        </Row>
        <div className="flex items-center gap-2 pt-1">
          <Button disabled={busy || !current || !next} onClick={save}>
            {busy ? "Saving…" : "Change password"}
          </Button>
          {msg && (
            <span className="flex items-center gap-1 text-[12px] text-success">
              <Icon name="check" size={14} /> {msg}
            </span>
          )}
          {err && <span className="text-[12px] text-danger">{err}</span>}
        </div>
        <p className="text-[11.5px] text-text-subtle">
          The default is the one from <span className="tnum">AIGETWEY_ADMIN_PASSWORD</span> (or <span className="tnum">123456</span>). Changing it here is optional and takes effect immediately.
        </p>
      </div>
    </RichCard>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] font-medium text-text-subtle">{label}</span>
      {children}
    </div>
  );
}
