/**
 * Anthropic streaming <-> canonical (OpenAI) chunks. The hard part.
 *
 * Anthropic streams a structured event sequence:
 *   message_start
 *   content_block_start / content_block_delta / content_block_stop  (per block)
 *   message_delta (carries stop_reason + output usage)
 *   message_stop
 *
 * OpenAI streams flat `choices[].delta` chunks. Translating requires a state
 * machine: tracking the message id, which block is open, and the mapping
 * between OpenAI tool-call indices and Anthropic block indices.
 */
import type { CanonicalChunk, CanonicalDeltaToolCall, ChunkFinishReason } from "./chunk.js";
import type { SSEEvent } from "./sse.js";

// ============================================================
// Anthropic SSE  ->  canonical chunks   (provider=anthropic, client=openai)
// ============================================================

interface AnthStreamState {
  id: string;
  model: string;
  /** anthropic block index -> openai tool-call index (only tool_use blocks) */
  toolIndexByBlock: Map<number, number>;
  nextToolIndex: number;
  promptTokens: number;
  cachedTokens?: number;
  cacheCreationTokens?: number;
}

export async function* streamToCanonical(events: AsyncIterable<SSEEvent>): AsyncGenerator<CanonicalChunk> {
  const state: AnthStreamState = {
    id: "",
    model: "",
    toolIndexByBlock: new Map(),
    nextToolIndex: 0,
    promptTokens: 0,
  };

  for await (const ev of events) {
    const data = ev.data.trim();
    if (!data || data === "[DONE]") continue;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = ev.event ?? (msg.type as string | undefined);

    switch (type) {
      case "message_start": {
        const message = msg.message as
          | { id?: string; model?: string; usage?: Record<string, number> }
          | undefined;
        state.id = message?.id ?? "";
        state.model = message?.model ?? "";
        const u = message?.usage;
        if (u) {
          state.promptTokens = u.input_tokens ?? 0;
          state.cachedTokens = u.cache_read_input_tokens;
          state.cacheCreationTokens = u.cache_creation_input_tokens;
        }
        const startChunk = baseChunk(state, { role: "assistant", content: "" }, null);
        startChunk.usage = {
          prompt_tokens: state.promptTokens,
          cached_tokens: state.cachedTokens,
          cache_creation_tokens: state.cacheCreationTokens,
        };
        yield startChunk;
        break;
      }

      case "content_block_start": {
        const block = msg.content_block as { type?: string; id?: string; name?: string } | undefined;
        const index = msg.index as number;
        if (block?.type === "tool_use") {
          const toolIndex = state.nextToolIndex++;
          state.toolIndexByBlock.set(index, toolIndex);
          const tc: CanonicalDeltaToolCall = {
            index: toolIndex,
            id: block.id,
            type: "function",
            function: { name: block.name, arguments: "" },
          };
          yield baseChunk(state, { tool_calls: [tc] }, null);
        }
        // text/thinking block_start carries no text; deltas follow
        break;
      }

      case "content_block_delta": {
        const delta = msg.delta as
          | { type?: string; text?: string; thinking?: string; partial_json?: string }
          | undefined;
        const index = msg.index as number;
        if (delta?.type === "text_delta") {
          yield baseChunk(state, { content: delta.text ?? "" }, null);
        } else if (delta?.type === "thinking_delta") {
          yield baseChunk(state, { reasoning: delta.thinking ?? "" }, null);
        } else if (delta?.type === "input_json_delta") {
          const toolIndex = state.toolIndexByBlock.get(index);
          if (toolIndex !== undefined) {
            const tc: CanonicalDeltaToolCall = {
              index: toolIndex,
              function: { arguments: delta.partial_json ?? "" },
            };
            yield baseChunk(state, { tool_calls: [tc] }, null);
          }
        }
        break;
      }

      case "message_delta": {
        const delta = msg.delta as { stop_reason?: string | null } | undefined;
        const usage = msg.usage as { output_tokens?: number } | undefined;
        const finish = mapStopReason(delta?.stop_reason);
        const chunk = baseChunk(state, {}, finish);
        chunk.usage = {
          prompt_tokens: state.promptTokens,
          completion_tokens: usage?.output_tokens ?? 0,
          cached_tokens: state.cachedTokens,
          cache_creation_tokens: state.cacheCreationTokens,
        };
        yield chunk;
        break;
      }

      // content_block_stop, message_stop, ping -> no canonical output
      default:
        break;
    }
  }
}

function baseChunk(
  state: AnthStreamState,
  delta: CanonicalChunk["choices"][0]["delta"],
  finish: ChunkFinishReason,
): CanonicalChunk {
  return {
    id: state.id || "chatcmpl-stream",
    model: state.model,
    created: 0,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

function mapStopReason(reason: string | null | undefined): ChunkFinishReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return null;
  }
}

// ============================================================
// canonical chunks  ->  Anthropic SSE   (provider=openai, client=anthropic)
// ============================================================

interface BuildState {
  id: string;
  model: string;
  started: boolean;
  /** the currently-open anthropic block index, or -1 if none */
  openBlock: number;
  /** what kind of block is open */
  openKind: "text" | "thinking" | "tool" | null;
  nextBlockIndex: number;
  /** openai tool index -> anthropic block index */
  toolBlockByIndex: Map<number, number>;
  promptTokens: number;
  completionTokens: number;
  finish: string | null;
}

function ev(event: string, data: Record<string, unknown>): SSEEvent {
  return { event, data: JSON.stringify({ type: event, ...data }) };
}

export async function* streamFromCanonical(chunks: AsyncIterable<CanonicalChunk>): AsyncGenerator<SSEEvent> {
  const s: BuildState = {
    id: "",
    model: "",
    started: false,
    openBlock: -1,
    openKind: null,
    nextBlockIndex: 0,
    toolBlockByIndex: new Map(),
    promptTokens: 0,
    completionTokens: 0,
    finish: null,
  };

  function* closeOpen(): Generator<SSEEvent> {
    if (s.openBlock !== -1) {
      yield ev("content_block_stop", { index: s.openBlock });
      s.openBlock = -1;
      s.openKind = null;
    }
  }

  for await (const chunk of chunks) {
    if (!s.started) {
      s.id = chunk.id || "msg_stream";
      s.model = chunk.model || "";
      s.promptTokens = chunk.usage?.prompt_tokens ?? 0;
      yield ev("message_start", {
        message: {
          id: s.id,
          type: "message",
          role: "assistant",
          model: s.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: s.promptTokens, output_tokens: 0 },
        },
      });
      s.started = true;
    }

    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta ?? {};

    // reasoning -> thinking block
    if (delta.reasoning) {
      if (s.openKind !== "thinking") {
        yield* closeOpen();
        s.openBlock = s.nextBlockIndex++;
        s.openKind = "thinking";
        yield ev("content_block_start", {
          index: s.openBlock,
          content_block: { type: "thinking", thinking: "" },
        });
      }
      yield ev("content_block_delta", {
        index: s.openBlock,
        delta: { type: "thinking_delta", thinking: delta.reasoning },
      });
    }

    // text -> text block
    if (typeof delta.content === "string" && delta.content.length > 0) {
      if (s.openKind !== "text") {
        yield* closeOpen();
        s.openBlock = s.nextBlockIndex++;
        s.openKind = "text";
        yield ev("content_block_start", { index: s.openBlock, content_block: { type: "text", text: "" } });
      }
      yield ev("content_block_delta", {
        index: s.openBlock,
        delta: { type: "text_delta", text: delta.content },
      });
    }

    // tool calls -> tool_use blocks
    for (const tc of delta.tool_calls ?? []) {
      let block = s.toolBlockByIndex.get(tc.index);
      if (block === undefined) {
        yield* closeOpen();
        block = s.nextBlockIndex++;
        s.toolBlockByIndex.set(tc.index, block);
        s.openBlock = block;
        s.openKind = "tool";
        yield ev("content_block_start", {
          index: block,
          content_block: { type: "tool_use", id: tc.id ?? `toolu_${block}`, name: tc.function?.name ?? "", input: {} },
        });
      }
      const frag = tc.function?.arguments;
      if (frag) {
        yield ev("content_block_delta", { index: block, delta: { type: "input_json_delta", partial_json: frag } });
      }
    }

    if (choice.finish_reason) s.finish = choice.finish_reason;
    if (chunk.usage?.completion_tokens) s.completionTokens = chunk.usage.completion_tokens;
  }

  // finalize
  yield* closeOpen();
  yield ev("message_delta", {
    delta: { stop_reason: reverseStop(s.finish), stop_sequence: null },
    usage: { output_tokens: s.completionTokens },
  });
  yield ev("message_stop", {});
}

function reverseStop(reason: string | null): string | null {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    default:
      return null;
  }
}
