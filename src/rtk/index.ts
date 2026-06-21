/**
 * RTK token saver. Compresses tool-output text inside tool messages before the
 * request is sent upstream, trimming redundant bulk (long diffs, huge grep
 * dumps, directory listings) that inflates input tokens without adding signal.
 *
 * Operates on the canonical request, so it's format-agnostic: an Anthropic
 * tool_result and an OpenAI tool message both arrive here as role="tool".
 *
 * Fail-open + safety net: a filtered result is only used when it's non-empty AND
 * smaller than the original. A detector/filter that throws is swallowed and the
 * original text kept — RTK must never break a request.
 */
import type { CanonicalMessage } from "../core/canonical.js";
import { detectShape } from "./detect.js";
import { applyFilter } from "./filters.js";

export interface RtkStats {
  /** number of tool outputs compressed */
  hits: number;
  bytesIn: number;
  bytesOut: number;
  shapes: string[];
}

function compressText(text: string, stats: RtkStats): string {
  let filtered: string;
  try {
    const shape = detectShape(text);
    if (!shape) return text;
    filtered = applyFilter(shape, text);
    // safety: never blank the content, never grow it
    if (!filtered || filtered.length >= text.length) return text;

    stats.hits++;
    stats.bytesIn += text.length;
    stats.bytesOut += filtered.length;
    stats.shapes.push(shape);
    return filtered;
  } catch {
    // fail-open: a buggy filter must not break the request
    return text;
  }
}

/**
 * Compress tool-output content in place. Returns stats (hits=0 when nothing was
 * compressible). Only touches role="tool" messages with string content.
 */
export function compressMessages(messages: CanonicalMessage[]): RtkStats {
  const stats: RtkStats = { hits: 0, bytesIn: 0, bytesOut: 0, shapes: [] };
  for (const msg of messages) {
    if (msg.role !== "tool") continue;
    if (typeof msg.content === "string") {
      msg.content = compressText(msg.content, stats);
    }
  }
  return stats;
}
