/**
 * OpenAI streaming <-> canonical chunks.
 * The canonical chunk IS the OpenAI chunk shape, so these are light passes:
 *  - streamToCanonical:   parse provider `data: {...}` frames into chunks
 *  - streamFromCanonical: serialize chunks back to `data: {...}` + `[DONE]`
 */
import type { CanonicalChunk } from "./chunk.js";
import type { SSEEvent } from "./sse.js";

export async function* streamToCanonical(events: AsyncIterable<SSEEvent>): AsyncGenerator<CanonicalChunk> {
  for await (const ev of events) {
    const data = ev.data.trim();
    if (!data || data === "[DONE]") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    yield normalize(parsed as CanonicalChunk);
  }
}

/** Lift vendor reasoning fields into the canonical `delta.reasoning`. */
function normalize(chunk: CanonicalChunk): CanonicalChunk {
  for (const choice of chunk.choices ?? []) {
    const d = choice.delta as (Record<string, unknown> & { reasoning?: string }) | undefined;
    if (!d) continue;
    if (d.reasoning === undefined) {
      const vendor = (d["reasoning_content"] as string | undefined) ?? (d["reasoning"] as string | undefined);
      if (vendor) d.reasoning = vendor;
    }
  }

  // Extract reasoning_tokens from OpenAI response.usage.completion_tokens_details.reasoning_tokens
  if (chunk.usage?.completion_tokens_details?.reasoning_tokens !== undefined) {
    chunk.usage.reasoning_tokens = chunk.usage.completion_tokens_details.reasoning_tokens;
  }

  return chunk;
}

export async function* streamFromCanonical(chunks: AsyncIterable<CanonicalChunk>): AsyncGenerator<SSEEvent> {
  for await (const chunk of chunks) {
    yield { data: JSON.stringify(chunk) };
  }
  yield { data: "[DONE]" };
}
