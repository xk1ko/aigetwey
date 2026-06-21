/**
 * RTK (tool-output) autodetect. Peeks the first window of a tool_result string
 * and classifies its format so the matching filter can compress it. Patterns are
 * tried in order; the first match wins. Returns null when nothing matches (the
 * text is then left untouched).
 */

export type ToolOutputShape = "git-diff" | "git-status" | "grep" | "tree" | "ls" | "find";

const DETECT_WINDOW = 1024;

interface Detector {
  shape: ToolOutputShape;
  test: (head: string) => boolean;
}

const DETECTORS: Detector[] = [
  // unified diff: `diff --git a/... b/...` or leading `--- ` / `+++ `
  { shape: "git-diff", test: (h) => /^diff --git /m.test(h) || /^--- .+\n\+\+\+ /m.test(h) },
  // git status --porcelain: two status columns then a path
  { shape: "git-status", test: (h) => /^[ MADRCU?!][ MADRCU?!] \S/m.test(h) },
  // grep -n / rg: `path:line:content` on most lines
  {
    shape: "grep",
    test: (h) => {
      const lines = h.split("\n").filter((l) => l.trim()).slice(0, 8);
      if (lines.length < 2) return false;
      const hits = lines.filter((l) => /^[^:\n]+:\d+:/.test(l)).length;
      return hits >= Math.ceil(lines.length / 2);
    },
  },
  // tree: box-drawing branch glyphs
  { shape: "tree", test: (h) => /[│├└]── /.test(h) },
  // ls -l: permission string at line start
  { shape: "ls", test: (h) => /^[-dlbcps][rwx-]{9}[ @.+]?\s/m.test(h) },
  // find / plain path list: most lines look like paths, no `:line:`
  {
    shape: "find",
    test: (h) => {
      const lines = h.split("\n").filter((l) => l.trim()).slice(0, 8);
      if (lines.length < 3) return false;
      const paths = lines.filter((l) => /^\.?\/?[\w.-]+(\/[\w.-]+)+\/?$/.test(l.trim())).length;
      return paths >= Math.ceil(lines.length / 2);
    },
  },
];

export function detectShape(text: string): ToolOutputShape | null {
  if (!text) return null;
  const head = text.slice(0, DETECT_WINDOW);
  for (const d of DETECTORS) {
    if (d.test(head)) return d.shape;
  }
  return null;
}
