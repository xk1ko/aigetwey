/**
 * Rolling-window engine: every budget window is a fixed-duration tumbling bucket
 * aligned to the epoch grid (no calendar/timezone math). `5h` resets every five
 * hours, `24h` daily, `7day` weekly, `30day` monthly — each on a rolling grid
 * rather than a calendar boundary. Shared by the budget tracker.
 */
const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

export type WindowName = "5h" | "24h" | "7day" | "30day";

export type WindowSpec = {
  window: WindowName;
  /** Epoch ms the recurring cycle is anchored to. Absent ⇒ epoch-grid (legacy). */
  anchor?: number;
};

const DURATION_MS: Record<WindowName, number> = {
  "5h": 5 * HOUR_MS,
  "24h": 24 * HOUR_MS,
  "7day": 7 * DAY_MS,
  "30day": 30 * DAY_MS,
};

/** Length (ms) of one window bucket. */
export function windowDuration(spec: WindowSpec): number {
  return DURATION_MS[spec.window];
}

/** Epoch ms of the START of the bucket containing `now`. Anchored to `spec.anchor`
 *  when present (cycles tumble from the anchor); otherwise floored to the epoch grid. */
export function currentWindowStart(spec: WindowSpec, now: number): number {
  const dur = DURATION_MS[spec.window];
  if (spec.anchor === undefined) return Math.floor(now / dur) * dur;
  if (now <= spec.anchor) return spec.anchor;
  return spec.anchor + Math.floor((now - spec.anchor) / dur) * dur;
}

/** Next reset instant: the end of the current bucket (windowStart + duration). */
export function nextResetAt(spec: WindowSpec, windowStart: number, _now: number): number {
  return windowStart + DURATION_MS[spec.window];
}

// `DAY_MS` is exported for any future window math that needs a day constant.
export { DAY_MS };
