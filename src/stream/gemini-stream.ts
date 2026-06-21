/**
 * Gemini streaming <-> canonical (OpenAI) chunks.
 *
 * Gemini's SSE (alt=sse) emits `data: {...}` frames, each a partial
 * GenerateContentResponse: candidates[0].content.parts carry text deltas,
 * functionCall parts arrive whole (not fragmented), and the final frame carries
 * finishReason + usageMetadata.
 */
import type { CanonicalChunk, CanonicalDeltaToolCall, ChunkFinishReason } from "./chunk.js";
import type { SSEEvent } from "./sse.js";

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
}

function mapFinish(reason: string | undefined): ChunkFinishReason {
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
      return "content_filter";
    default:
      return null;
  }
}

// ============================================================
// Gemini SSE -> canonical chunks   (provider=gemini)
// ============================================================

export async function* streamToCanonical(events: AsyncIterable<SSEEvent>): AsyncGenerator<CanonicalChunk> {
  let toolIndex = 0;
  let started = false;

  for await (const ev of events) {
    const data = ev.data.trim();
    if (!data || data === "[DONE]") continue;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }

    const cand = (msg.candidates as Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>)?.[0];
    const model = (msg.modelVersion as string | undefined) ?? "";
    const base = (delta: CanonicalChunk["choices"][0]["delta"], finish: ChunkFinishReason): CanonicalChunk => ({
      id: "gemini-stream",
      model,
      created: 0,
      choices: [{ index: 0, delta, finish_reason: finish }],
    });

    if (!started) {
      started = true;
      yield base({ role: "assistant", content: "" }, null);
    }

    for (const p of cand?.content?.parts ?? []) {
      if (typeof p.text === "string" && p.text.length > 0) {
        yield base({ content: p.text }, null);
      } else if (p.functionCall) {
        const tc: CanonicalDeltaToolCall = {
          index: toolIndex,
          id: `call_${p.functionCall.name}_${toolIndex}`,
          type: "function",
          function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) },
        };
        toolIndex++;
        yield base({ tool_calls: [tc] }, null);
      }
    }

    const usageMetadata = msg.usageMetadata as
      | { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number }
      | undefined;
    if (cand?.finishReason || usageMetadata) {
      const chunk = base({}, mapFinish(cand?.finishReason));
      if (usageMetadata) {
        chunk.usage = {
          prompt_tokens: usageMetadata.promptTokenCount ?? 0,
          completion_tokens: usageMetadata.candidatesTokenCount ?? 0,
          cached_tokens: usageMetadata.cachedContentTokenCount,
        };
      }
      yield chunk;
    }
  }
}

// ============================================================
// canonical chunks -> Gemini SSE   (client=gemini)
// ============================================================

export async function* streamFromCanonical(chunks: AsyncIterable<CanonicalChunk>): AsyncGenerator<SSEEvent> {
  let promptTokens = 0;
  let completionTokens = 0;
  let finish: string | null = null;

  for await (const chunk of chunks) {
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta ?? {};
    const parts: GeminiPart[] = [];

    if (typeof delta.content === "string" && delta.content.length > 0) {
      parts.push({ text: delta.content });
    }
    for (const tc of delta.tool_calls ?? []) {
      if (tc.function?.name) {
        let args: Record<string, unknown> = {};
        try {
          args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          args = {};
        }
        parts.push({ functionCall: { name: tc.function.name, args } });
      }
    }

    if (chunk.usage?.prompt_tokens) promptTokens = chunk.usage.prompt_tokens;
    if (chunk.usage?.completion_tokens) completionTokens = chunk.usage.completion_tokens;
    if (choice.finish_reason) finish = reverseFinish(choice.finish_reason);

    // emit a frame whenever there's content; the terminal frame also carries
    // finishReason + usage.
    if (parts.length > 0 || choice.finish_reason) {
      const payload: Record<string, unknown> = {
        candidates: [
          { content: { role: "model", parts }, ...(choice.finish_reason ? { finishReason: finish } : {}), index: 0 },
        ],
      };
      if (choice.finish_reason) {
        payload.usageMetadata = {
          promptTokenCount: promptTokens,
          candidatesTokenCount: completionTokens,
          totalTokenCount: promptTokens + completionTokens,
        };
      }
      yield { data: JSON.stringify(payload) };
    }
  }
}

function reverseFinish(reason: string): string {
  switch (reason) {
    case "length":
      return "MAX_TOKENS";
    case "content_filter":
      return "SAFETY";
    default:
      return "STOP";
  }
}
