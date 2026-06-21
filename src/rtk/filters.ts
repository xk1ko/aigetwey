/**
 * RTK per-format compressors. Each takes a tool-output string and returns a
 * shorter equivalent, trimming redundant bulk a model rarely needs while keeping
 * the signal. Callers apply a safety net (never empty, never larger); filters
 * here just do the format-specific trimming.
 */
import type { ToolOutputShape } from "./detect.js";

const MAX_HUNK_LINES = 80; // per diff hunk
const MAX_GREP_PER_FILE = 10; // matches kept per file
const MAX_LIST_LINES = 200; // ls / find / tree entries

function elide(n: number, noun: string): string {
  return `… (${n} more ${noun} elided by rtk)`;
}

/** Truncate long hunks in a unified diff, keeping headers + a bounded body. */
function filterGitDiff(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let hunkBody = 0;
  for (const line of lines) {
    if (line.startsWith("diff --git ") || line.startsWith("@@")) {
      hunkBody = 0;
      out.push(line);
      continue;
    }
    if (/^(---|\+\+\+|index |new file|deleted file|similarity|rename) /.test(line)) {
      out.push(line);
      continue;
    }
    hunkBody++;
    if (hunkBody <= MAX_HUNK_LINES) out.push(line);
    else if (hunkBody === MAX_HUNK_LINES + 1) out.push(elide(0, "hunk lines"));
  }
  return out.join("\n");
}

/** git status --porcelain is already terse; just cap pathological lengths. */
function filterGitStatus(text: string): string {
  return capLines(text, MAX_LIST_LINES, "changes");
}

/** Cap matches per file in grep/rg output, keeping the file grouping. */
function filterGrep(text: string): string {
  const perFile = new Map<string, number>();
  const out: string[] = [];
  let skipped = 0;
  for (const line of text.split("\n")) {
    const m = /^([^:\n]+):(\d+):/.exec(line);
    if (!m) {
      out.push(line);
      continue;
    }
    const file = m[1]!;
    const n = (perFile.get(file) ?? 0) + 1;
    perFile.set(file, n);
    if (n <= MAX_GREP_PER_FILE) out.push(line);
    else skipped++;
  }
  if (skipped > 0) out.push(elide(skipped, "matches"));
  return out.join("\n");
}

function filterTree(text: string): string {
  return capLines(text, MAX_LIST_LINES, "entries");
}
function filterLs(text: string): string {
  return capLines(text, MAX_LIST_LINES, "entries");
}
function filterFind(text: string): string {
  return capLines(text, MAX_LIST_LINES, "paths");
}

function capLines(text: string, max: number, noun: string): string {
  const lines = text.split("\n");
  if (lines.length <= max) return text;
  const kept = lines.slice(0, max);
  kept.push(elide(lines.length - max, noun));
  return kept.join("\n");
}

const FILTERS: Record<ToolOutputShape, (t: string) => string> = {
  "git-diff": filterGitDiff,
  "git-status": filterGitStatus,
  grep: filterGrep,
  tree: filterTree,
  ls: filterLs,
  find: filterFind,
};

export function applyFilter(shape: ToolOutputShape, text: string): string {
  return FILTERS[shape](text);
}
