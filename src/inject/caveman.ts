/**
 * Caveman injection. Prepends a system instruction telling the model to answer
 * in terse "caveman speak" — dropping articles, filler and pleasantries while
 * keeping full technical substance — to cut OUTPUT tokens.
 *
 * Four intensities trade brevity against readability. Returns null for "off" so
 * the handler can skip injection entirely.
 */

export type InjectLevel = "off" | "lite" | "full" | "ultra";

const PROMPTS: Record<Exclude<InjectLevel, "off">, string> = {
  lite:
    "Trim filler. Drop pleasantries (sure/certainly/happy to), hedging, and " +
    "restating the question. Keep all technical substance, code, and exact error " +
    "text verbatim. Prefer short words.",
  full:
    "Answer like a terse expert. Drop articles (a/an/the), filler " +
    "(just/really/basically/actually), pleasantries, and hedging. Fragments OK. " +
    "Short synonyms (big not extensive, fix not implement-a-solution-for). " +
    "Keep ALL technical substance, exact identifiers, and code blocks unchanged. " +
    "Quote error messages exactly. Pattern: [thing] [action] [reason].",
  ultra:
    "Maximum compression. Telegraphic fragments only — no articles, no filler, no " +
    "pleasantries, no transitions. One idea per line where possible. Keep every " +
    "technical fact, identifier, number, and code block exact and complete; never " +
    "drop substance to save words. Quote errors verbatim. Prose is the enemy; " +
    "information is not.",
};

/** System-prompt text for a caveman level, or null when off. */
export function cavemanPrompt(level: InjectLevel): string | null {
  if (level === "off") return null;
  return PROMPTS[level];
}
