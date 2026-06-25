import { describe, it, expect } from "vitest";
import { parseSSE, serializeSSE } from "../src/stream/sse.js";
import * as openaiStream from "../src/stream/openai-stream.js";
import * as anthropicStream from "../src/stream/anthropic-stream.js";
import * as geminiStream from "../src/stream/gemini-stream.js";
import type { SSEEvent } from "../src/stream/sse.js";
import type { CanonicalChunk } from "../src/stream/chunk.js";

/** Wrap strings as a byte stream, optionally splitting mid-frame to test buffering. */
async function* bytes(...parts: string[]): AsyncGenerator<Uint8Array> {
  const enc = new TextEncoder();
  for (const p of parts) yield enc.encode(p);
}

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

async function* fromArray<T>(arr: T[]): AsyncGenerator<T> {
  for (const x of arr) yield x;
}

describe("parseSSE", () => {
  it("parses simple data frames", async () => {
    const events = await collect(parseSSE(bytes('data: {"a":1}\n\n', "data: [DONE]\n\n")));
    expect(events).toEqual([{ event: undefined, data: '{"a":1}' }, { event: undefined, data: "[DONE]" }]);
  });

  it("reassembles a frame split across byte chunks", async () => {
    const events = await collect(parseSSE(bytes('data: {"hel', 'lo":1}\n\n')));
    expect(events).toEqual([{ event: undefined, data: '{"hello":1}' }]);
  });

  it("reads the anthropic event: field", async () => {
    const events = await collect(parseSSE(bytes('event: message_start\ndata: {"type":"message_start"}\n\n')));
    expect(events[0]!.event).toBe("message_start");
  });

  it("flushes a trailing frame without terminator", async () => {
    const events = await collect(parseSSE(bytes('data: {"x":1}')));
    expect(events).toEqual([{ event: undefined, data: '{"x":1}' }]);
  });
});

describe("serializeSSE", () => {
  it("round-trips through parse", async () => {
    const ev: SSEEvent = { event: "message_delta", data: '{"type":"message_delta"}' };
    const events = await collect(parseSSE(bytes(serializeSSE(ev))));
    expect(events[0]).toEqual(ev);
  });
});

describe("openai stream — identity", () => {
  it("parses provider chunks and re-serializes with [DONE]", async () => {
    const provider: SSEEvent[] = [
      { data: '{"id":"c","model":"gpt-4o","created":0,"choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}' },
      { data: "[DONE]" },
    ];
    const chunks = await collect(openaiStream.streamToCanonical(fromArray(provider)));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.choices[0]!.delta.content).toBe("hi");

    const out = await collect(openaiStream.streamFromCanonical(fromArray(chunks)));
    expect(out[out.length - 1]!.data).toBe("[DONE]");
  });

  // Regression: the OpenAI finish_reason chunk carries no `delta`; the trailing
  // usage chunk (stream_options.include_usage) has empty `choices`. The parser
  // must not throw on either, or the stream aborts before usage is captured.
  it("survives a delta-less finish chunk and captures the trailing usage chunk", async () => {
    const provider: SSEEvent[] = [
      { data: '{"choices":[{"index":0,"delta":{"content":"Hi"}}]}' },
      { data: '{"choices":[{"finish_reason":"stop","index":0}]}' }, // no delta
      { data: '{"choices":[],"usage":{"prompt_tokens":146,"completion_tokens":22,"total_tokens":168}}' },
      { data: "[DONE]" },
    ];
    const chunks = await collect(openaiStream.streamToCanonical(fromArray(provider)));
    const usage = chunks.find((c) => c.usage)?.usage;
    expect(usage).toMatchObject({ prompt_tokens: 146, completion_tokens: 22 });
  });
});

describe("anthropic stream — provider SSE -> canonical", () => {
  function anthropicEvents(): SSEEvent[] {
    return [
      { event: "message_start", data: JSON.stringify({ type: "message_start", message: { id: "msg_1", model: "claude", usage: { input_tokens: 10 } } }) },
      { event: "content_block_start", data: JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) },
      { event: "content_block_delta", data: JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }) },
      { event: "content_block_delta", data: JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } }) },
      { event: "content_block_stop", data: JSON.stringify({ type: "content_block_stop", index: 0 }) },
      { event: "message_delta", data: JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }) },
      { event: "message_stop", data: JSON.stringify({ type: "message_stop" }) },
    ];
  }

  it("collapses the event sequence into canonical text deltas + usage", async () => {
    const chunks = await collect(anthropicStream.streamToCanonical(fromArray(anthropicEvents())));
    const text = chunks.map((c) => c.choices[0]!.delta.content ?? "").join("");
    expect(text).toBe("Hello world");
    const finishChunk = chunks.find((c) => c.choices[0]!.finish_reason);
    expect(finishChunk!.choices[0]!.finish_reason).toBe("stop");
    expect(finishChunk!.usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 5 });
  });

  it("translates streaming tool_use into canonical tool_call deltas", async () => {
    const events: SSEEvent[] = [
      { event: "message_start", data: JSON.stringify({ type: "message_start", message: { id: "m", model: "claude", usage: { input_tokens: 1 } } }) },
      { event: "content_block_start", data: JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "get_weather" } }) },
      { event: "content_block_delta", data: JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"city":' } }) },
      { event: "content_block_delta", data: JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"NYC"}' } }) },
      { event: "message_delta", data: JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 3 } }) },
    ];
    const chunks = await collect(anthropicStream.streamToCanonical(fromArray(events)));
    const args = chunks
      .flatMap((c) => c.choices[0]!.delta.tool_calls ?? [])
      .map((tc) => tc.function?.arguments ?? "")
      .join("");
    expect(args).toBe('{"city":"NYC"}');
    expect(chunks.find((c) => c.choices[0]!.finish_reason)!.choices[0]!.finish_reason).toBe("tool_calls");
  });
});

describe("anthropic stream — canonical -> provider SSE", () => {
  it("emits message_start, text blocks, message_delta, message_stop", async () => {
    const chunks: CanonicalChunk[] = [
      { id: "msg_1", model: "claude", created: 0, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }], usage: { prompt_tokens: 7 } },
      { id: "msg_1", model: "claude", created: 0, choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }] },
      { id: "msg_1", model: "claude", created: 0, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { completion_tokens: 2 } },
    ];
    const events = await collect(anthropicStream.streamFromCanonical(fromArray(chunks)));
    const types = events.map((e) => e.event);
    expect(types).toContain("message_start");
    expect(types).toContain("content_block_start");
    expect(types).toContain("content_block_delta");
    expect(types).toContain("message_delta");
    expect(types).toContain("message_stop");
  });
});

describe("gemini stream", () => {
  it("translates Gemini SSE frames into canonical text + usage", async () => {
    const events: SSEEvent[] = [
      { data: JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Hel" }] } }], modelVersion: "gemini-pro" }) },
      { data: JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "lo" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 } }) },
    ];
    const chunks = await collect(geminiStream.streamToCanonical(fromArray(events)));
    const text = chunks.map((c) => c.choices[0]!.delta.content ?? "").join("");
    expect(text).toBe("Hello");
    expect(chunks.find((c) => c.choices[0]!.finish_reason)!.usage).toMatchObject({ prompt_tokens: 4, completion_tokens: 2 });
  });

  it("re-serializes canonical chunks into Gemini frames", async () => {
    const chunks: CanonicalChunk[] = [
      { id: "g", model: "gemini-pro", created: 0, choices: [{ index: 0, delta: { content: "hey" }, finish_reason: null }] },
      { id: "g", model: "gemini-pro", created: 0, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ];
    const events = await collect(geminiStream.streamFromCanonical(fromArray(chunks)));
    const last = JSON.parse(events[events.length - 1]!.data);
    expect(last.candidates[0].finishReason).toBe("STOP");
    expect(last.usageMetadata.totalTokenCount).toBe(2);
  });
});

describe("cross-format streaming — openai provider chunks to an anthropic client", () => {
  it("an OpenAI text stream renders as an Anthropic event sequence", async () => {
    const providerEvents: SSEEvent[] = [
      { data: '{"id":"c","model":"gpt-4o","created":0,"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}' },
      { data: '{"id":"c","model":"gpt-4o","created":0,"choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}' },
      { data: '{"id":"c","model":"gpt-4o","created":0,"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}' },
      { data: "[DONE]" },
    ];
    const canonical = openaiStream.streamToCanonical(fromArray(providerEvents));
    const clientEvents = await collect(anthropicStream.streamFromCanonical(canonical));
    const types = clientEvents.map((e) => e.event);
    expect(types[0]).toBe("message_start");
    expect(types).toContain("content_block_delta");
    expect(types[types.length - 1]).toBe("message_stop");
    // the text survived the OpenAI -> canonical -> Anthropic hop
    const textDelta = clientEvents.find((e) => e.event === "content_block_delta" && e.data.includes("text_delta"));
    expect(textDelta!.data).toContain("Hi");
  });
});
