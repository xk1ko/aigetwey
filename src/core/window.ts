const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

export type WindowName = string;

export type WindowSpec = {
  window: WindowName;
  anchor?: number;
};

const WINDOW_RE = /^(\d+)(h|day)$/;

function parseDuration(window: string): number {
  const m = WINDOW_RE.exec(window);
  if (!m) throw new Error(`invalid window: ${window}`);
  const n = Number(m[1]);
  if (n <= 0) throw new Error(`invalid window: ${window}`);
  return m[2] === "h" ? n * HOUR_MS : n * DAY_MS;
}

export function windowDuration(spec: WindowSpec): number {
  return parseDuration(spec.window);
}

export function currentWindowStart(spec: WindowSpec, now: number): number {
  const dur = parseDuration(spec.window);
  if (spec.anchor === undefined) return Math.floor(now / dur) * dur;
  if (now <= spec.anchor) return spec.anchor;
  return spec.anchor + Math.floor((now - spec.anchor) / dur) * dur;
}

export function nextResetAt(spec: WindowSpec, windowStart: number): number {
  return windowStart + parseDuration(spec.window);
}

export { DAY_MS };
