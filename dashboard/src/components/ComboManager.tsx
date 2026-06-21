"use client";

import { useEffect, useState, useCallback } from "react";
import { adminApi } from "@/lib/client";
import { Badge } from "@/components/Badge";
import { RichCard, CardTitle } from "@/components/RichCard";
import { Button, Input } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Empty } from "@/components/ui";
import type { ComboSnapshot } from "@/lib/gateway";

export function ComboManager() {
  const [combos, setCombos] = useState<ComboSnapshot[]>([]);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");

  const reload = useCallback(async () => {
    const r = await adminApi.combos();
    if (!r.ok) {
      setError(r.error ?? "could not reach the gateway");
      return;
    }
    setError("");
    setCombos(r.data?.combos ?? []);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(label);
    const r = await fn();
    setBusy("");
    if (!r.ok) setError(r.error ?? "action failed");
    else {
      setError("");
      await reload();
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-[16px] font-semibold tracking-tight text-text">Saved Presets</h2>
        <p className="mt-0.5 text-[13px] text-text-muted">
          Save the current routing table as a named preset, then switch between them in one click.
        </p>
      </div>

      <RichCard className="mb-5" header={<CardTitle title="Save current routing" sub="snapshots the live alias table" />}>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="preset name, e.g. free-forever" />
          <Button
            disabled={!name || busy === "create"}
            onClick={() => run("create", async () => {
              const r = await adminApi.createCombo(name);
              if (r.ok) setName("");
              return r;
            })}
          >
            <Icon name="bookmark_add" size={16} /> Save preset
          </Button>
        </div>
      </RichCard>

      {error && <div className="mb-3 text-[12px] text-danger">{error}</div>}

      {combos.length === 0 ? (
        <Empty>No presets saved yet.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {combos.map((c) => (
            <div key={c.name} className={`rounded-brand-lg border bg-surface p-4 shadow-soft ${c.active ? "border-accent" : "border-border"}`}>
              <div className="flex items-center justify-between gap-2">
                {renaming === c.name ? (
                  <Input value={renameTo} autoFocus onChange={(e) => setRenameTo(e.target.value)} placeholder={c.name} />
                ) : (
                  <span className="truncate text-[14px] font-semibold text-text">{c.name}</span>
                )}
                {c.active && <Badge tone="live">active</Badge>}
              </div>
              <div className="mt-1 text-[12px] text-text-muted">{c.models.length} aliases</div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {renaming === c.name ? (
                  <>
                    <Button disabled={busy === "rename"} onClick={() => run("rename", async () => {
                      const r = await adminApi.renameCombo(c.name, renameTo || c.name);
                      if (r.ok) setRenaming(null);
                      return r;
                    })}>Save</Button>
                    <Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    {!c.active && (
                      <Button disabled={busy === `act${c.name}`} onClick={() => run(`act${c.name}`, () => adminApi.activateCombo(c.name))}>
                        <Icon name="play_arrow" size={16} /> Activate
                      </Button>
                    )}
                    <IconBtn label="Rename" icon="edit" onClick={() => { setRenaming(c.name); setRenameTo(c.name); }} />
                    <IconBtn label="Copy" icon="content_copy" onClick={() => run(`copy${c.name}`, () => adminApi.copyCombo(c.name, `${c.name}-copy`))} />
                    <IconBtn label="Delete" icon="delete" danger onClick={() => run(`del${c.name}`, () => adminApi.deleteCombo(c.name))} />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IconBtn({ label, icon, onClick, danger }: { label: string; icon: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-8 w-8 items-center justify-center rounded-brand border border-border text-text-muted transition-colors ${
        danger ? "hover:border-danger/50 hover:text-danger" : "hover:border-text-subtle hover:text-text"
      }`}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}
