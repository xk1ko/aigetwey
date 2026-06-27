"use client";

import { useEffect, useState, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { adminApi } from "@/lib/client";
import { Lamp } from "@/components/Lamp";
import { Badge } from "@/components/Badge";
import { RichCard, CardTitle } from "@/components/RichCard";
import { Button, Input, Select, Field } from "@/components/Button";
import { ModelPicker, type ModelGroup } from "@/components/ModelPicker";
import { Icon } from "@/components/Icon";
import { ConfirmModal } from "@/components/ConfirmModal";
import { fmt, Empty } from "@/components/ui";
import type { MaskedConfig, MaskedRoute, ProviderSnapshot } from "@/lib/gateway";

/** Upstream model id for the i-th target of a route (mirrors GatewayConfig). */
function modelFor(route: MaskedRoute, i: number): string {
  if (Array.isArray(route.model)) return route.model[i] ?? route.model[0] ?? route.alias;
  if (typeof route.model === "string") return route.model;
  return route.alias;
}

const COLLAPSE_AT = 5;

function ChainList({
  route,
  healthy,
  chainTest,
  chainBusy,
}: {
  route: MaskedRoute;
  healthy: (pid: string) => boolean;
  chainTest: Record<string, Record<number, "testing" | "ok" | "fail">>;
  chainBusy: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const total = route.target.length;
  const show = expanded || total <= COLLAPSE_AT ? total : COLLAPSE_AT;

  return (
    <div>
      <ol className="space-y-1.5">
        {route.target.slice(0, show).map((pid, i) => {
          const ct = chainTest[route.alias]?.[i];
          const testLamp = ct === "ok" ? "live" : ct === "fail" ? "down" : ct === "testing" ? "idle" : null;
          return (
            <li key={pid + i} className="flex items-center gap-2.5 rounded-brand border border-border-subtle px-3 py-2">
              <span className="tnum text-[11px] text-text-subtle">#{i + 1}</span>
              <Lamp state={testLamp ?? (healthy(pid) ? "live" : "down")} />
              <span className="text-[13px] text-text">{pid}</span>
              <span className="ml-auto tnum text-[12px] text-text-muted">{modelFor(route, i)}</span>
              {ct === "ok" && <Icon name="check_circle" size={14} className="text-success" />}
              {ct === "fail" && <Icon name="cancel" size={14} className="text-danger" />}
              {ct === "testing" && <Icon name="progress_activity" size={14} className="text-text-subtle" />}
            </li>
          );
        })}
      </ol>
      {total > COLLAPSE_AT && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 w-full rounded-brand py-1.5 text-[12px] font-medium text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          {expanded ? "Show less" : `Show all ${total}`}
        </button>
      )}
    </div>
  );
}

export function RoutingView() {
  const [config, setConfig] = useState<MaskedConfig | null>(null);
  const [health, setHealth] = useState<ProviderSnapshot[]>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState("");
  const [chainTest, setChainTest] = useState<Record<string, Record<number, "testing" | "ok" | "fail">>>({});
  const [chainBusy, setChainBusy] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<MaskedRoute | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  const reload = useCallback(async () => {
    const [cfgRes, prov] = await Promise.all([fetch("/api/gw/admin/config"), adminApi.providers()]);
    if (!cfgRes.ok) {
      setError("could not reach the gateway");
      return;
    }
    setError("");
    setConfig((await cfgRes.json()) as MaskedConfig);
    setHealth(prov.data?.providers ?? []);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (error) return <Empty>{error}</Empty>;
  if (!config) return <Empty>Loading…</Empty>;

  const healthy = (pid: string) => {
    const h = health.find((x) => x.id === pid);
    return h ? h.keys.some((k) => k.healthy) : true;
  };

  async function del(alias: string) {
    setBusy(alias);
    const r = await adminApi.removeRoute(alias);
    setBusy("");
    if (!r.ok) setError(r.error ?? "failed");
    else await reload();
  }

  async function testChain(route: MaskedRoute) {
    setChainBusy(route.alias);
    setChainTest((prev) => ({ ...prev, [route.alias]: {} }));
    for (let i = 0; i < route.target.length; i++) {
      setChainTest((prev) => ({ ...prev, [route.alias]: { ...prev[route.alias], [i]: "testing" } }));
      const r = await adminApi.testProvider(route.target[i]!);
      const ok = r.ok && r.data?.ok;
      setChainTest((prev) => ({ ...prev, [route.alias]: { ...prev[route.alias], [i]: ok ? "ok" : "fail" } }));
      if (i < route.target.length - 1) await new Promise((resolve) => setTimeout(resolve, 400));
    }
    setChainBusy(null);
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-text">Combos</h1>
          <p className="mt-1 text-[13px] text-text-muted">
            Aliases your CLI tools call, routed across a chain of providers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowInfo((v) => !v)} className="flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-2 hover:text-text" aria-label="Strategy info">
            <Icon name="info" size={18} />
          </button>
          <Button onClick={() => setAdding((v) => !v)}>
            <Icon name={adding ? "close" : "add"} size={17} />
            {adding ? "Cancel" : "Add combo"}
          </Button>
        </div>
      </div>

      {showInfo && (
        <div className="mb-5 rounded-brand-lg border border-border bg-surface p-4 shadow-soft">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-[13px] font-semibold text-text">Fallback</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">
                Always starts from #1 in the chain. If it fails (quota, rate-limit, error), moves to #2, then #3, until one succeeds. Every new request starts from #1 again.
              </p>
              <p className="mt-1.5 text-[11.5px] text-text-subtle">Best when you have a preferred primary provider and others as backup.</p>
            </div>
            <div>
              <h3 className="text-[13px] font-semibold text-text">Round-robin</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">
                Rotates the starting provider each request to spread load. With sticky, N consecutive requests go to the same provider before rotating. If a provider fails, falls back to the next in chain.
              </p>
              <p className="mt-1.5 text-[11.5px] text-text-subtle">Best when all providers are equal and you want to distribute traffic.</p>
            </div>
          </div>
        </div>
      )}

      {adding && (
        <RouteForm
          providers={config.providers.filter((p) => !p.disabled)}
          onDone={() => { setAdding(false); void reload(); }}
        />
      )}

      {editing && !adding && (
        <RouteForm
          providers={config.providers.filter((p) => !p.disabled)}
          initial={editing}
          onDone={() => { setEditing(null); void reload(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {config.models.length === 0 ? (
        <Empty>No combos yet. Add one to expose a model alias to your CLI tools.</Empty>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {config.models.map((route) => (
            <RichCard
              key={route.alias}
              header={
                <>
                  <CardTitle title={route.alias} sub={`${route.target.length} in chain`} />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => testChain(route)}
                      disabled={chainBusy === route.alias}
                      className="inline-flex items-center gap-1 rounded-brand border border-border bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-muted transition-colors hover:bg-surface-3 hover:text-text disabled:opacity-60"
                      title="Test each provider in this chain"
                    >
                      <Icon name={chainBusy === route.alias ? "progress_activity" : "sync"} size={14} />
                      Test
                    </button>
                    <Badge tone={route.strategy === "round-robin" ? "info" : "neutral"}>{route.strategy}</Badge>
                    {(route.price_in !== undefined || route.price_out !== undefined) && (
                      <Badge tone="neutral">
                        {fmt.cost(route.price_in ?? 0)}/{fmt.cost(route.price_out ?? 0)} per 1M
                      </Badge>
                    )}
                    <button onClick={() => { setEditing(route); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="flex h-7 w-7 items-center justify-center rounded-brand text-text-muted transition-colors hover:bg-surface-2 hover:text-text" aria-label="Edit combo">
                      <Icon name="edit" size={16} />
                    </button>
                    <button onClick={() => setPendingDelete(route.alias)} disabled={busy === route.alias} className="flex h-7 w-7 items-center justify-center rounded-brand text-text-muted transition-colors hover:bg-surface-2 hover:text-danger" aria-label="Remove alias">
                      <Icon name="delete" size={16} />
                    </button>
                  </div>
                </>
              }
            >
              <ChainList
                route={route}
                healthy={healthy}
                chainTest={chainTest}
                chainBusy={chainBusy}
              />
            </RichCard>
          ))}
        </div>
      )}

      {pendingDelete && (
        <ConfirmModal
          title="Remove combo"
          message={`Delete "${pendingDelete}"? CLI tools using this alias will stop working.`}
          confirmLabel="Remove"
          busy={busy === pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            void del(pendingDelete).then(() => setPendingDelete(null));
          }}
        />
      )}
    </div>
  );
}

// Combo create form, for aigetwey's ComboFormModal: a name + ONE ordered
// list of concrete `provider/model` entries (fallback priority), picked from the
// providers' catalogs. On save each entry splits into target[i]/model[i].
type ProviderOption = { id: string; models: { id: string }[] };

function RouteForm({ providers, onDone, initial, onCancel }: { providers: ProviderOption[]; onDone: () => void; initial?: MaskedRoute; onCancel?: () => void }) {
  const isEdit = !!initial;
  const [alias, setAlias] = useState(initial?.alias ?? "");
  const [entries, setEntries] = useState<string[]>(() => {
    if (!initial) return [];
    return initial.target.map((pid, i) => {
      const m = Array.isArray(initial.model) ? initial.model[i] ?? initial.model[0] : initial.model ?? initial.alias;
      return `${pid}/${m}`;
    });
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [strategy, setStrategy] = useState<"fallback" | "round-robin">(initial?.strategy ?? "fallback");
  const [sticky, setSticky] = useState(initial?.sticky ?? 1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // aigetwey-style picker: provider-grouped, click a model to add/remove it.
  const groups: ModelGroup[] = providers
    .filter((p) => p.models.length > 0)
    .map((p) => ({ label: p.id, items: p.models.map((m) => ({ value: `${p.id}/${m.id}`, label: `${p.id}/${m.id}` })) }));

  function toggle(v: string) {
    setErr("");
    setEntries((e) => (e.includes(v) ? e.filter((x) => x !== v) : [...e, v]));
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setEntries((items) => {
      const oldI = items.indexOf(String(active.id));
      const newI = items.indexOf(String(over.id));
      return arrayMove(items, oldI, newI);
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!alias || entries.length === 0) {
      setErr("a name and at least one model are required");
      return;
    }
    setBusy(true);
    setErr("");
    const target = entries.map((x) => x.slice(0, x.indexOf("/")));
    const model = entries.map((x) => x.slice(x.indexOf("/") + 1));
    const r = await adminApi.setRoute(alias, {
      target,
      model,
      strategy,
      sticky: strategy === "round-robin" ? sticky : undefined,
    });
    // rename: the new alias is saved above; drop the old one so it doesn't linger.
    if (r.ok && isEdit && initial!.alias !== alias) {
      await adminApi.removeRoute(initial!.alias);
    }
    setBusy(false);
    if (r.ok) onDone();
    else setErr(r.error ?? "failed");
  }

  return (
    <form onSubmit={submit} className="mb-5 rounded-brand-lg border border-border bg-surface p-4 shadow-soft">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Alias" hint="the name your CLI requests as a model">
          <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="my-combo" />
        </Field>
        <Field label="Strategy" hint="how the chain is tried">
          <Select value={strategy} onChange={(e) => setStrategy(e.target.value as "fallback" | "round-robin")}>
            <option value="fallback">Fallback — try in order, next on failure</option>
            <option value="round-robin">Round Robin — rotate to spread load</option>
          </Select>
        </Field>
      </div>

      {strategy === "round-robin" && (
        <Field label="Sticky" hint="requests per model before rotating">
          <div className="flex items-center gap-2">
            <button type="button" disabled={sticky <= 1} onClick={() => setSticky((s) => Math.max(1, s - 1))} className="flex h-9 w-9 items-center justify-center rounded-brand border border-border bg-bg text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40" aria-label="Decrease sticky">
              <Icon name="remove" size={16} />
            </button>
            <span className="tnum w-10 text-center text-[14px] font-medium text-text">{sticky}</span>
            <button type="button" onClick={() => setSticky((s) => s + 1)} className="flex h-9 w-9 items-center justify-center rounded-brand border border-border bg-bg text-text-muted transition-colors hover:bg-surface-2 hover:text-text" aria-label="Increase sticky">
              <Icon name="add" size={16} />
            </button>
          </div>
        </Field>
      )}

      <div className="mt-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">
            Models — fallback order (drag to reorder)
          </span>
          <Button type="button" variant="ghost" onClick={() => setPickerOpen(true)}>
            <Icon name="add" size={16} /> Add models
          </Button>
        </div>

        {entries.length === 0 ? (
          <div className="mt-2 rounded-brand border border-dashed border-border-subtle px-3 py-4 text-center text-[12px] text-text-subtle">
            No models yet. Click <span className="text-text-muted">Add models</span> and pick from your providers.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={entries} strategy={verticalListSortingStrategy}>
              <ul className="mt-2 max-h-[280px] space-y-1.5 overflow-y-auto">
                {entries.map((entry, i) => (
                  <SortableEntry key={entry} entry={entry} index={i} onRemove={() => setEntries((e) => e.filter((_, idx) => idx !== i))} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {err && <div className="mt-2 text-[12px] text-danger">{err}</div>}
      <div className="mt-3 flex justify-end gap-2">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : isEdit ? "Update combo" : "Save combo"}</Button>
      </div>

      {pickerOpen && (
        <ModelPicker
          title="Add models to the chain"
          note="Click a model to add it, click again to remove. Drag to reorder after."
          groups={groups}
          selected={entries}
          onToggle={toggle}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </form>
  );
}

function SortableEntry({ entry, index, onRemove }: { entry: string; index: number; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry });
  const style = {
    transform: `translate3d(0, ${transform?.y ?? 0}px, 0)`,
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`flex cursor-grab items-center gap-2.5 rounded-brand border px-3 py-2 active:cursor-grabbing ${
        isDragging ? "border-accent bg-accent-soft opacity-80 shadow-elevated z-10" : "border-border-subtle"
      }`}
    >
      <Icon name="drag_indicator" size={16} className="flex-none text-text-subtle" />
      <span className="tnum text-[11px] text-text-subtle">#{index + 1}</span>
      <span className="tnum truncate text-[13px] text-text">{entry}</span>
      <button
        type="button"
        onClick={onRemove}
        onPointerDown={(e) => e.stopPropagation()}
        className="ml-auto flex-none text-text-subtle hover:text-danger"
        aria-label={`Remove ${entry}`}
      >
        <Icon name="close" size={14} />
      </button>
    </li>
  );
}
