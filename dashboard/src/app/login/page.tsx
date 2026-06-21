"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Field } from "@/components/Button";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.replace("/");
      router.refresh();
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "login failed");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-[360px] rounded-brand-lg border border-border bg-surface p-7 shadow-elevated"
      >
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-7 w-7 flex-none items-center justify-center rounded-brand bg-accent text-[14px] font-bold text-accent-ink shadow-warm">
            a
          </span>
          <span className="text-[16px] font-semibold tracking-tight text-text">aigetwey</span>
        </div>

        <h1 className="text-[19px] font-semibold tracking-tight text-text">Welcome back</h1>
        <p className="mb-6 mt-1 text-[13px] text-text-muted">Enter the admin password to continue.</p>

        <Field label="Password">
          <Input type="password" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} />
        </Field>

        {error && <div className="mt-2.5 text-[12px] text-danger">{error}</div>}

        <Button type="submit" disabled={busy} className="mt-6 w-full">
          {busy ? "Connecting…" : "Connect"}
        </Button>
      </form>
    </main>
  );
}
