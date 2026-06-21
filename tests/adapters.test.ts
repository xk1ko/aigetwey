import { describe, it, expect } from "vitest";
import * as anthropic from "../src/adapters/anthropic.js";
import * as gemini from "../src/adapters/gemini.js";
import * as openai from "../src/adapters/openai.js";
import { adapterFor } from "../src/adapters/index.js";
import type { CanonicalRequest, CanonicalResponse } from "../src/core/canonical.js";

describe("adapterFor", () => {
  it("returns an adapter per wire format", () => {
    expect(adapterFor("openai")).toBeDefined();
    expect(adapterFor("anthropic")).toBeDefined();
    expect(adapterFor("gemini")).toBeDefined();
  });
});

describe("openai adapter — identity", () => {
  it("passes a request through unchanged", () => {
    const req = { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] };
    expect(openai.requestToCanonical(req)).toBe(req);
    expect(openai.requestFromCanonical(req as CanonicalRequest)).toBe(req);
  });
});

describe("anthropic ingress — request -> canonical", () => {
  it("lifts the system prompt into a system message", () => {
    const c = anthropic.requestToCanonical({
      model: "claude",
      system: "be brief",
      max_tokens: 100,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(c.messages[0]).toEqual({ role: "system", content: "be brief" });
    expect(c.messages[1]).toEqual({ role: "user", content: "hello" });
    expect(c.max_tokens).toBe(100);
  });

  it("splits tool_result blocks into role=tool messages", () => {
    const c = anthropic.requestToCanonical({
      model: "claude",
      max_tokens: 50,
      messages: [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "call_1", content: "42" }],
        },
      ],
    });
    expect(c.messages).toEqual([{ role: "tool", tool_call_id: "call_1", content: "42" }]);
  });

  it("maps assistant tool_use to tool_calls", () => {
    const c = anthropic.requestToCanonical({
      model: "claude",
      max_tokens: 50,
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "call_1", name: "get_weather", input: { city: "NYC" } }],
        },
      ],
    });
    expect(c.messages[0]!.tool_calls).toEqual([
      { id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"NYC"}' } },
    ]);
  });

  it("maps tools to canonical tool defs", () => {
    const c = anthropic.requestToCanonical({
      model: "claude",
      max_tokens: 50,
      messages: [{ role: "user", content: "x" }],
      tools: [{ name: "f", description: "d", input_schema: { type: "object" } }],
    });
    expect(c.tools).toEqual([
      { type: "function", function: { name: "f", description: "d", parameters: { type: "object" } } },
    ]);
  });
});

describe("anthropic egress — canonical -> request", () => {
  it("re-collapses system messages into the system field", () => {
    const out = anthropic.requestFromCanonical({
      model: "claude",
      max_tokens: 64,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
    }) as { system: string; messages: unknown[]; max_tokens: number };
    expect(out.system).toBe("sys");
    expect(out.max_tokens).toBe(64);
    expect(out.messages).toHaveLength(1);
  });

  it("defaults max_tokens when absent (Anthropic requires it)", () => {
    const out = anthropic.requestFromCanonical({
      model: "claude",
      messages: [{ role: "user", content: "hi" }],
    }) as { max_tokens: number };
    expect(out.max_tokens).toBe(4096);
  });

  it("turns a tool message into a user tool_result block", () => {
    const out = anthropic.requestFromCanonical({
      model: "claude",
      max_tokens: 10,
      messages: [{ role: "tool", tool_call_id: "call_9", content: "done" }],
    }) as { messages: Array<{ role: string; content: Array<{ type: string; tool_use_id: string }> }> };
    expect(out.messages[0]!.role).toBe("user");
    expect(out.messages[0]!.content[0]!.type).toBe("tool_result");
    expect(out.messages[0]!.content[0]!.tool_use_id).toBe("call_9");
  });
});

describe("anthropic response translation", () => {
  it("converts an Anthropic reply to canonical with usage", () => {
    const c = anthropic.responseToCanonical({
      id: "msg_1",
      model: "claude",
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(c.choices[0]!.message.content).toBe("hello");
    expect(c.choices[0]!.finish_reason).toBe("stop");
    expect(c.usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  });

  it("renders canonical back to an Anthropic reply", () => {
    const resp: CanonicalResponse = {
      id: "msg_2",
      model: "claude",
      created: 0,
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    };
    const out = anthropic.responseFromCanonical(resp) as {
      type: string;
      content: Array<{ type: string; text: string }>;
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };
    expect(out.type).toBe("message");
    expect(out.content[0]).toEqual({ type: "text", text: "hi" });
    expect(out.stop_reason).toBe("end_turn");
    expect(out.usage).toEqual({ input_tokens: 3, output_tokens: 4 });
  });
});

describe("anthropic round-trip — request preserves tool conversation", () => {
  it("ingress then egress keeps tool_use and tool_result linkage", () => {
    const original = {
      model: "claude",
      max_tokens: 100,
      messages: [
        { role: "user", content: "weather?" },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "call_1", name: "wx", input: { c: "NYC" } }],
        },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "sunny" }] },
      ],
    };
    const canonical = anthropic.requestToCanonical(original);
    const back = anthropic.requestFromCanonical(canonical) as {
      messages: Array<{ role: string; content: Array<{ type: string }> }>;
    };
    // assistant tool_use survives
    const assistant = back.messages.find((m) => m.role === "assistant")!;
    expect(assistant.content.some((b) => b.type === "tool_use")).toBe(true);
    // tool_result survives as a user block
    const toolResult = back.messages.find((m) => m.content?.some?.((b) => b.type === "tool_result"));
    expect(toolResult).toBeDefined();
  });
});

describe("gemini ingress — request -> canonical", () => {
  it("lifts systemInstruction and maps model role to assistant", () => {
    const c = gemini.requestToCanonical({
      model: "gemini-pro",
      systemInstruction: { parts: [{ text: "sys" }] },
      contents: [
        { role: "user", parts: [{ text: "hi" }] },
        { role: "model", parts: [{ text: "yo" }] },
      ],
    });
    expect(c.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(c.messages[1]).toEqual({ role: "user", content: "hi" });
    expect(c.messages[2]).toEqual({ role: "assistant", content: "yo" });
  });

  it("maps functionResponse parts to tool messages", () => {
    const c = gemini.requestToCanonical({
      contents: [{ role: "user", parts: [{ functionResponse: { name: "wx", response: { temp: 20 } } }] }],
    });
    expect(c.messages[0]!.role).toBe("tool");
    expect(c.messages[0]!.name).toBe("wx");
  });
});

describe("gemini egress + response", () => {
  it("builds contents with systemInstruction and generationConfig", () => {
    const out = gemini.requestFromCanonical({
      model: "gemini-pro",
      max_tokens: 256,
      temperature: 0.5,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
    }) as {
      systemInstruction: { parts: Array<{ text: string }> };
      contents: Array<{ role: string }>;
      generationConfig: { maxOutputTokens: number; temperature: number };
    };
    expect(out.systemInstruction.parts[0]!.text).toBe("sys");
    expect(out.contents[0]!.role).toBe("user");
    expect(out.generationConfig.maxOutputTokens).toBe(256);
    expect(out.generationConfig.temperature).toBe(0.5);
  });

  it("converts a Gemini reply to canonical with usage", () => {
    const c = gemini.responseToCanonical({
      candidates: [{ content: { role: "model", parts: [{ text: "answer" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3 },
      modelVersion: "gemini-pro",
    });
    expect(c.choices[0]!.message.content).toBe("answer");
    expect(c.choices[0]!.finish_reason).toBe("stop");
    expect(c.usage).toMatchObject({ prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 });
  });
});

describe("cross-format — anthropic client to openai-shaped canonical to gemini provider", () => {
  it("an anthropic request survives translation into a gemini provider body", () => {
    const canonical = anthropic.requestToCanonical({
      model: "claude",
      system: "be terse",
      max_tokens: 100,
      messages: [{ role: "user", content: "ping" }],
    });
    const geminiBody = gemini.requestFromCanonical(canonical) as {
      systemInstruction: { parts: Array<{ text: string }> };
      contents: Array<{ role: string; parts: Array<{ text: string }> }>;
    };
    expect(geminiBody.systemInstruction.parts[0]!.text).toBe("be terse");
    expect(geminiBody.contents[0]!.parts[0]!.text).toBe("ping");
  });
});
