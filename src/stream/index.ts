import type { CanonicalChunk } from "./chunk.js";
import type { SSEEvent } from "./sse.js";
import type { WireFormat } from "../core/canonical.js";
import * as openaiStream from "./openai-stream.js";
import * as anthropicStream from "./anthropic-stream.js";
import * as geminiStream from "./gemini-stream.js";

export interface StreamAdapter {
  /** provider SSE events -> canonical chunks */
  streamToCanonical(events: AsyncIterable<SSEEvent>): AsyncGenerator<CanonicalChunk>;
  /** canonical chunks -> client SSE events */
  streamFromCanonical(chunks: AsyncIterable<CanonicalChunk>): AsyncGenerator<SSEEvent>;
}

const STREAM_ADAPTERS: Record<WireFormat, StreamAdapter> = {
  openai: openaiStream,
  anthropic: anthropicStream,
  gemini: geminiStream,
};

export function streamAdapterFor(format: WireFormat): StreamAdapter {
  return STREAM_ADAPTERS[format];
}
