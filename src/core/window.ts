/**
 * Timezone-aware window/calendar engine: given a window spec (5h rolling, or a
 * daily/weekly/monthly calendar boundary), compute the next reset instant and
 * the start of the current window. Shared by the budget tracker.
 */
const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export type WindowSpec = {
  window: "5h" | "daily" | "weekly" | "monthly";
  reset_at?: string;
  timezone: string;
};

/** Wall-clock offset (ms) of `tz` at instant `date`: tzWallAsUTC - actualUTC. */
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUTC - date.getTime();
}

/** Convert a desired wall-clock time in `tz` to an epoch ms. DST-corrected once. */
function zonedWallToEpoch(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guessUTC = Date.UTC(y, mo, d, h, mi);
  const offset = tzOffsetMs(new Date(guessUTC), tz);
  let epoch = guessUTC - offset;
  const offset2 = tzOffsetMs(new Date(epoch), tz);
  if (offset2 !== offset) epoch = guessUTC - offset2;
  return epoch;
}

/** Wall-clock parts of `nowMs` in `tz`. */
function zonedParts(nowMs: number, tz: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(nowMs).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month) - 1,
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: String(p.weekday).toLowerCase(),
  };
}

function parseHHMM(reset_at: string | undefined): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(reset_at ?? "");
  if (!m) return { h: 0, m: 0 };
  return { h: Math.min(23, Number(m[1])), m: Math.min(59, Number(m[2])) };
}

/**
 * Next reset instant (epoch ms) strictly after `now` for a window schedule.
 */
export function nextResetAt(spec: WindowSpec, windowStart: number, now: number): number {
  const tz = spec.timezone || "UTC";
  if (spec.window === "5h") return windowStart + 5 * HOUR_MS;

  const p = zonedParts(now, tz);

  if (spec.window === "daily") {
    const { h, m } = parseHHMM(spec.reset_at);
    let candidate = zonedWallToEpoch(p.year, p.month, p.day, h, m, tz);
    if (candidate <= now) candidate = zonedWallToEpoch(p.year, p.month, p.day + 1, h, m, tz);
    return candidate;
  }

  if (spec.window === "weekly") {
    const target = WEEKDAYS.indexOf((spec.reset_at ?? "monday").toLowerCase());
    const targetIdx = target === -1 ? 1 : target;
    const curIdx = WEEKDAYS.indexOf(p.weekday);
    const daysAhead = (targetIdx - curIdx + 7) % 7;
    let candidate = zonedWallToEpoch(p.year, p.month, p.day + daysAhead, 0, 0, tz);
    if (candidate <= now) candidate = zonedWallToEpoch(p.year, p.month, p.day + daysAhead + 7, 0, 0, tz);
    return candidate;
  }

  // monthly: first of next month at 00:00
  return zonedWallToEpoch(p.year, p.month + 1, 1, 0, 0, tz);
}

/**
 * Epoch ms of the START of the window containing `now`.
 */
export function currentWindowStart(spec: WindowSpec, now: number): number {
  const tz = spec.timezone || "UTC";
  if (spec.window === "5h") return Math.floor(now / (5 * HOUR_MS)) * (5 * HOUR_MS);

  const p = zonedParts(now, tz);

  if (spec.window === "daily") {
    const { h, m } = parseHHMM(spec.reset_at);
    let start = zonedWallToEpoch(p.year, p.month, p.day, h, m, tz);
    if (start > now) start = zonedWallToEpoch(p.year, p.month, p.day - 1, h, m, tz);
    return start;
  }

  if (spec.window === "weekly") {
    const target = WEEKDAYS.indexOf((spec.reset_at ?? "monday").toLowerCase());
    const targetIdx = target === -1 ? 1 : target;
    const curIdx = WEEKDAYS.indexOf(p.weekday);
    const daysBehind = (curIdx - targetIdx + 7) % 7;
    let start = zonedWallToEpoch(p.year, p.month, p.day - daysBehind, 0, 0, tz);
    if (start > now) start = zonedWallToEpoch(p.year, p.month, p.day - daysBehind - 7, 0, 0, tz);
    return start;
  }

  // monthly
  return zonedWallToEpoch(p.year, p.month, 1, 0, 0, tz);
}

// `DAY_MS` is exported for any future window math that needs a day constant.
export { DAY_MS };
