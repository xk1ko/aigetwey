/**
 * Canonical streaming unit = OpenAI Chat Completion *chunk*.
 * Provider SSE is translated INTO a stream of these; client SSE is translated
 * OUT of them. Mirrors the non-streaming canonical shape.
 */

export interface CanonicalDeltaToolCall {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    /** partial JSON fragment of arguments */
    arguments?: string;
  };
}

export interface CanonicalChunkDelta {
  role?: "assistant";
  content?: string | null;
  /** reasoning/thinking text, normalized across providers */
  reasoning?: string;
  tool_calls?: CanonicalDeltaToolCall[];
}

export interface CanonicalChunkUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
  cache_creation_tokens?: number;
  reasoning_tokens?: number;
}

export type ChunkFinishReason = "stop" | "length" | "tool_calls" | "content_filter" | null;

export interface CanonicalChunk {
  id: string;
  model: string;
  created: number;
  choices: Array<{
    index: number;
    delta: CanonicalChunkDelta;
    finish_reason: ChunkFinishReason;
  }>;
  usage?: CanonicalChunkUsage;
}
