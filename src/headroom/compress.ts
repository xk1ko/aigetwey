/**
 * Request-time context compression via the external Headroom proxy.
 *
 * aigetwey's canonical request is OpenAI-shaped, and Headroom's /v1/compress only
 * understands OpenAI shape — so we compress canonical.messages directly, no
 * per-format translation dance (aigetwey has to translate Claude bodies first).
 * Fail-open: any error returns null and the request proceeds uncompressed.
 *
 * aigetwey's own implementation.
 */
import type { CanonicalMessage } from "../core/canonical.js";

const DEFAULT_TIMEOUT_MS = 3000;

export interface HeadroomStats {
  tokens_before?: number;
  tokens_after?: number;
  tokens_saved?: number;
}

export interface HeadroomCompressOpts {
  url: string;
  model: string;
  compressUserMessages?: boolean;
  timeoutMs?: number;
}

interface CompressReply extends HeadroomStats {
  messages: CanonicalMessage[];
}

// POST messages to Headroom /v1/compress; returns compressed messages + stats or null.
async function callCompress(
  url: string,
  messages: CanonicalMessage[],
  model: string,
  timeoutMs: number,
  compressUserMessages?: boolean,
): Promise<CompressReply | null> {
  const endpoint = `${String(url).replace(/\/$/, "")}/v1/compress`;
  const payload: Record<string, unknown> = { messages, model };
  if (compressUserMessages) payload.config = { compress_user_messages: true };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as CompressReply;
  if (!Array.isArray(data?.messages)) return null;
  return data;
}

/**
 * Compress messages via the Headroom proxy. Returns the compressed messages +
 * stats, or null on any failure (caller keeps the original messages).
 */
export async function compressWithHeadroom(
  messages: CanonicalMessage[],
  { url, model, compressUserMessages, timeoutMs = DEFAULT_TIMEOUT_MS }: HeadroomCompressOpts,
): Promise<CompressReply | null> {
  if (!url || !Array.isArray(messages) || messages.length === 0) return null;
  try {
    return await callCompress(url, messages, model, timeoutMs, compressUserMessages);
  } catch {
    return null;
  }
}

export function formatHeadroomLog(stats: HeadroomStats | null): string | null {
  if (!stats) return null;
  const before = stats.tokens_before || 0;
  const after = stats.tokens_after || 0;
  const saved = stats.tokens_saved || 0;
  const pct = before > 0 ? ((saved / before) * 100).toFixed(1) : "0";
  return `saved ${saved} tokens / ${before} (${pct}%) ${after ? `after=${after}` : ""}`.trim();
}
