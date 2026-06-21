import type { CanonicalRequest, CanonicalResponse, WireFormat } from "../core/canonical.js";
import * as openai from "./openai.js";
import * as anthropic from "./anthropic.js";
import * as gemini from "./gemini.js";

export interface Adapter {
  requestToCanonical(body: unknown): CanonicalRequest;
  requestFromCanonical(req: CanonicalRequest): unknown;
  responseToCanonical(resp: unknown): CanonicalResponse;
  responseFromCanonical(resp: CanonicalResponse): unknown;
}

const ADAPTERS: Record<WireFormat, Adapter> = { openai, anthropic, gemini };

export function adapterFor(format: WireFormat): Adapter {
  return ADAPTERS[format];
}
