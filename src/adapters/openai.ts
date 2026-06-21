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
  return resp as CanonicalResponse;
}

export function responseFromCanonical(resp: CanonicalResponse): unknown {
  return resp;
}
