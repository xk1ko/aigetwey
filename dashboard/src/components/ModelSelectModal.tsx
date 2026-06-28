"use client";

import { useState, useMemo } from "react";
import { Button, Input } from "@/components/Button";
import { Checkbox } from "@/components/Checkbox";
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
  const [picked, setPicked] = useState<Set<string>>(() => new Set());

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const base = q ? models.filter((m) => m.id.toLowerCase().includes(q)) : models;
    return [...base].sort((a, b) => Number(b.added) - Number(a.added));
  }, [models, filter]);

  function toggle(id: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const pickable = shown.filter((m) => !m.added);
  const shownPickedCount = pickable.filter((m) => picked.has(m.id)).length;
  const allShownPicked = pickable.length > 0 && shownPickedCount === pickable.length;
  const someShownPicked = shownPickedCount > 0 && !allShownPicked;
  function toggleAllShown() {
    setPicked((s) => {
      const next = new Set(s);
      if (allShownPicked) pickable.forEach((m) => next.delete(m.id));
      else pickable.forEach((m) => next.add(m.id));
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-[480px] flex-col overflow-hidden rounded-brand-lg glass-strong modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <span className="text-[14px] font-semibold text-text">{models.length} models found</span>
          <button onClick={onClose} className="text-text-subtle hover:text-text" aria-label="Close">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="border-b border-border-subtle px-4 py-2.5">
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter…" autoFocus />
        </div>

        {/* select-all row: an obvious clickable control, not an ambiguous button */}
        {shown.length > 0 && (
          <button
            onClick={toggleAllShown}
            className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-2 text-left hover:bg-surface-2"
          >
            <Checkbox checked={allShownPicked} indeterminate={someShownPicked} onChange={toggleAllShown} ariaLabel="Select all" />
            <span className="text-[13px] font-medium text-text">Select all{filter ? " (filtered)" : ""}</span>
            <span className="ml-auto tnum text-[11px] text-text-subtle">
              {shownPickedCount}/{pickable.length}
            </span>
          </button>
        )}

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {shown.length === 0 ? (
            <div className="px-2 py-6 text-center text-[13px] text-text-muted">No matches.</div>
          ) : (
            shown.map((m) => {
              const sel = picked.has(m.id);
              if (m.added) {
                return (
                  <div
                    key={m.id}
                    className="flex w-full cursor-not-allowed items-center gap-2.5 rounded-brand border border-transparent px-2.5 py-2 opacity-40"
                  >
                    <div className="h-[18px] w-[18px] flex-none rounded-[5px] border border-border bg-bg" />
                    <span className="flex-1 truncate text-[13px] text-text">{m.id}</span>
                    <span className="text-[11px] text-text-subtle">in catalog</span>
                  </div>
                );
              }
              return (
                <button
                  key={m.id}
                  onClick={() => toggle(m.id)}
                  className={`flex w-full items-center gap-2.5 rounded-brand border px-2.5 py-2 text-left transition-colors ${
                    sel ? "border-accent/40 bg-accent-soft" : "border-transparent hover:bg-surface-2"
                  }`}
                >
                  <Checkbox checked={sel} onChange={() => toggle(m.id)} ariaLabel={m.id} />
                  <span className="flex-1 truncate text-[13px] text-text">{m.id}</span>
                </button>
              );
            })
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border-subtle bg-bg-alt px-4 py-2.5">
          <span className="tnum text-[12px] text-text-muted">{picked.size} selected</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={picked.size === 0 || busy} onClick={() => onAdd([...picked])}>
              {busy ? "Adding…" : `Add ${picked.size}`}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
