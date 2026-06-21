"use client";

import { useState, useMemo } from "react";
import { Button, Input } from "@/components/Button";
import { Icon } from "@/components/Icon";

export interface DiscoveredModel {
  id: string;
  added: boolean; // already in the provider catalog
}

/**
 * Pick which discovered models to add. Free providers can return hundreds of
 * ids, so this is a filterable checklist (defaulting to only the not-yet-added
 * ones selected) rather than dumping everything into the catalog.
 */
export function ModelSelectModal({
  models,
  busy,
  onAdd,
  onClose,
}: {
  models: DiscoveredModel[];
  busy: boolean;
  onAdd: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(models.filter((m) => !m.added).map((m) => m.id)));

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? models.filter((m) => m.id.toLowerCase().includes(q)) : models;
  }, [models, filter]);

  function toggle(id: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allShownPicked = shown.length > 0 && shown.every((m) => picked.has(m.id));
  function toggleAllShown() {
    setPicked((s) => {
      const next = new Set(s);
      if (allShownPicked) shown.forEach((m) => next.delete(m.id));
      else shown.forEach((m) => next.add(m.id));
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-[480px] flex-col overflow-hidden rounded-brand-lg border border-border bg-surface shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <span className="text-[14px] font-semibold text-text">
            {models.length} models found
          </span>
          <button onClick={onClose} className="text-text-subtle hover:text-text" aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="border-b border-border-subtle px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter…" autoFocus />
            <Button variant="ghost" onClick={toggleAllShown}>
              {allShownPicked ? "None" : "All"}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {shown.length === 0 ? (
            <div className="px-2 py-6 text-center text-[13px] text-text-muted">No matches.</div>
          ) : (
            shown.map((m) => (
              <label
                key={m.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-brand px-2 py-1.5 hover:bg-surface-2"
              >
                <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} />
                <span className="flex-1 truncate text-[12.5px] text-text">{m.id}</span>
                {m.added && <span className="text-[11px] text-text-subtle">in catalog</span>}
              </label>
            ))
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border-subtle bg-bg-alt px-4 py-2.5">
          <span className="tnum text-[12px] text-text-muted">{picked.size} selected</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={picked.size === 0 || busy} onClick={() => onAdd([...picked])}>
              {busy ? "Adding…" : `Add ${picked.size}`}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
