/**
 * OpenAI adapter. The canonical format IS the OpenAI Chat Completions shape, so
 * these are near-identity passes — they exist so every format flows through the
 * same adapter interface.
 */
import type { CanonicalRequest, CanonicalResponse } from "../core/canonical.js";

export function requestToCanonical(body: unknown): CanonicalRequest {
  return body as CanonicalRequest;
}

export function requestFromCanonical(req: CanonicalRequest): unknown {
  return req;
}

export function responseToCanonical(resp: unknown): CanonicalResponse {
  const r = resp as CanonicalResponse;
  // Flatten OpenAI usage detail fields into the canonical flat shape so non-stream
  // requests also record cached/reasoning tokens.
  const u = r?.usage as
    | (NonNullable<CanonicalResponse["usage"]> & {
        prompt_tokens_details?: { cached_tokens?: number };
        completion_tokens_details?: { reasoning_tokens?: number };
      })
    | undefined;
  if (u) {
    if (u.cached_tokens === undefined && u.prompt_tokens_details?.cached_tokens !== undefined) {
      u.cached_tokens = u.prompt_tokens_details.cached_tokens;
    }
    if (u.reasoning_tokens === undefined && u.completion_tokens_details?.reasoning_tokens !== undefined) {
      u.reasoning_tokens = u.completion_tokens_details.reasoning_tokens;
    }
  }
  return r;
}

export function responseFromCanonical(resp: CanonicalResponse): unknown {
  return resp;
}
