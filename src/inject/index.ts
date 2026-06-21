/**
 * Inject orchestrator. Builds the combined caveman + ponytail system prompt and
 * prepends it to a canonical request's messages, in place.
 *
 * Pipeline order (handler): RTK compresses tool_result in the input first, THEN
 * inject prepends the output-style prompt — they touch different parts of the
 * request and stack cleanly (RTK shrinks input, caveman shrinks output prose,
 * ponytail shrinks output code).
 *
 * Fail-open: an injection error must never break a request — the caller wraps
 * this in try/catch and proceeds without injection.
 */
import type { CanonicalMessage, CanonicalRequest } from "../core/canonical.js";
import { cavemanPrompt, type InjectLevel } from "./caveman.js";
import { ponytailPrompt } from "./ponytail.js";

export type { InjectLevel } from "./caveman.js";

export interface InjectSettings {
  caveman: InjectLevel;
  ponytail: InjectLevel;
}

/** Combined system-prompt text for the active toggles, or null if both off. */
export function buildInjection(settings: InjectSettings): string | null {
  const parts = [cavemanPrompt(settings.caveman), ponytailPrompt(settings.ponytail)].filter(
    (p): p is string => p !== null,
  );
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * Prepend the injection as the FIRST system message. A dedicated leading system
 * message (rather than merging into an existing one) keeps the gateway's
 * instruction separate from the client's own system prompt, and works for every
 * provider format since the adapter collapses system messages on egress.
 *
 * Returns true if anything was injected.
 */
export function injectInto(req: CanonicalRequest, settings: InjectSettings): boolean {
  const text = buildInjection(settings);
  if (!text) return false;
  const sys: CanonicalMessage = { role: "system", content: text };
  req.messages.unshift(sys);
  return true;
}
