/**
 * Ponytail injection. Prepends a system instruction nudging the model toward a
 * "lazy senior dev" coding style — minimal, YAGNI, deletion over addition — to
 * cut OUTPUT tokens AND reduce over-engineered code.
 *
 * Shares the InjectLevel scale with caveman; the two stack (caveman shapes prose
 * style, ponytail shapes code style). Returns null for "off".
 */
import type { InjectLevel } from "./caveman.js";

const PROMPTS: Record<Exclude<InjectLevel, "off">, string> = {
  lite:
    "Prefer the smallest change that solves the problem. Don't add features, " +
    "abstractions, or error handling beyond what was asked.",
  full:
    "Code like a lazy senior dev: do the minimum that fully solves the task. " +
    "YAGNI — no speculative abstractions, config, or future-proofing. Prefer " +
    "deleting code over adding it. No defensive checks for cases that can't " +
    "happen. Don't explain code that's self-evident. Don't refactor unrelated code.",
  ultra:
    "Ruthless minimalism. Smallest possible diff. No new abstractions, no " +
    "helpers for single callers, no comments unless a non-obvious WHY. Delete " +
    "before you add. Skip boilerplate, validation, and error handling unless " +
    "explicitly required. Output only the code that changed plus a one-line note.",
};

/** System-prompt text for a ponytail level, or null when off. */
export function ponytailPrompt(level: InjectLevel): string | null {
  if (level === "off") return null;
  return PROMPTS[level];
}
