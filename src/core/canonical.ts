/**
 * Canonical message format = OpenAI Chat Completions shape.
 *
 * Every ingress format is translated INTO this shape, and every provider format
 * is translated OUT of it. Picking OpenAI as the pivot makes a new provider cost
 * one adapter (N adapters) instead of N×N pairwise translators.
 */

export type Role = "system" | "user" | "assistant" | "tool";

export interface CanonicalTextPart {
  type: "text";
  text: string;
}

export interface CanonicalImagePart {
  type: "image_url";
  image_url: { url: string };
}

export type CanonicalContentPart = CanonicalTextPart | CanonicalImagePart;

export interface CanonicalToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** raw JSON string of args, exactly as OpenAI emits it */
    arguments: string;
  };
}

export interface CanonicalMessage {
  role: Role;
  /** string for simple text, multi-part array for mixed content, or null */
  content: string | CanonicalContentPart[] | null;
  /** assistant turns that call tools */
  tool_calls?: CanonicalToolCall[];
  /** present on role="tool" messages, links back to a tool_call id */
  tool_call_id?: string;
  /** tool/function name on tool messages */
  name?: string;
}

export interface CanonicalToolDef {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface CanonicalRequest {
  model: string;
  messages: CanonicalMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  tools?: CanonicalToolDef[];
  tool_choice?: unknown;
  /** anything else passes through untouched */
  [k: string]: unknown;
}

export interface CanonicalUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** cached input tokens, normalized across providers */
  cached_tokens?: number;
  cache_creation_tokens?: number;
  reasoning_tokens?: number;
}

export type FinishReason = "stop" | "length" | "tool_calls" | "content_filter" | null;

export interface CanonicalResponse {
  id: string;
  model: string;
  created: number;
  choices: Array<{
    index: number;
    message: CanonicalMessage;
    finish_reason: FinishReason;
  }>;
  usage?: CanonicalUsage;
}

/** Wire format spoken by a provider or expected by a client. */
export type WireFormat = "openai" | "anthropic" | "gemini";
