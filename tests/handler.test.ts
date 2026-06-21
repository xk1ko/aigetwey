import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock undici.request so the handler can be exercised without a network call.
const requestMock = vi.fn();
vi.mock("undici", () => ({ request: (...args: unknown[]) => requestMock(...args) }));

import { handle, GatewayError, type HandleDeps } from "../src/core/handler.js";
import { validateConfig } from "../src/config.js";
import { KeyPool } from "../src/core/keypool.js";

function depsWith(): HandleDeps {
  const config = validateConfig({
    providers: [
      { id: "oa", format: "openai", base_url: "https://oa.test/v1", api_key: "sk-oa" },
      { id: "an", format: "anthropic", base_url: "https://an.test/v1", api_key: "sk-an" },
    ],
    models: [
      { alias: "smart", target: ["oa"], model: "gpt-4o" },
      { alias: "claude-ish", target: ["an"], model: "claude-3" },
    ],
  });
  return { config, pool: new KeyPool() };
}

/** Build a fake undici response object. */
function fakeResponse(statusCode: number, json: unknown) {
  return {
    statusCode,
    body: {
      json: async () => json,
      text: async () => JSON.stringify(json),
      dump: async () => {},
    },
  };
}

beforeEach(() => {
  requestMock.mockReset();
});

describe("handle — non-stream pipeline", () => {
  it("404s an unknown model", async () => {
    await expect(handle(depsWith(), "openai", { model: "ghost", messages: [] })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("400s a request with no model", async () => {
    await expect(handle(depsWith(), "openai", { messages: [] })).rejects.toMatchObject({ status: 400 });
  });

  it("returns an SSE stream for a streaming request", async () => {
    const frames = [
      'data: {"id":"c","model":"gpt-4o","created":0,"choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n',
      "data: [DONE]\n\n",
    ];
    async function* body() {
      const enc = new TextEncoder();
      for (const f of frames) yield enc.encode(f);
    }
    requestMock.mockResolvedValue({ statusCode: 200, body: body() });

    const res = await handle(depsWith(), "openai", { model: "smart", messages: [], stream: true });
    expect(res.status).toBe(200);
    expect(res.sse).toBeDefined();
    let text = "";
    const dec = new TextDecoder();
    for await (const bytes of res.sse!) text += dec.decode(bytes);
    expect(text).toContain('"content":"hi"');
    expect(text).toContain("[DONE]");
  });

  it("routes an OpenAI client request to an OpenAI provider and returns the reply", async () => {
    const upstreamJson = {
      id: "chatcmpl-1",
      model: "gpt-4o",
      created: 1,
      choices: [{ index: 0, message: { role: "assistant", content: "hi there" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    };
    requestMock.mockResolvedValue(fakeResponse(200, upstreamJson));

    const res = await handle(depsWith(), "openai", { model: "smart", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ choices: [{ message: { content: "hi there" } }] });

    // verify the upstream URL + bearer key were built from provider config
    const [url, opts] = requestMock.mock.calls[0]!;
    expect(url).toBe("https://oa.test/v1/chat/completions");
    expect((opts as { headers: Record<string, string> }).headers.authorization).toBe("Bearer sk-oa");
  });

  it("translates an Anthropic client request through an Anthropic provider", async () => {
    const anthropicReply = {
      id: "msg_1",
      model: "claude-3",
      role: "assistant",
      content: [{ type: "text", text: "pong" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 4, output_tokens: 1 },
    };
    requestMock.mockResolvedValue(fakeResponse(200, anthropicReply));

    const res = await handle(depsWith(), "anthropic", {
      model: "claude-ish",
      max_tokens: 50,
      messages: [{ role: "user", content: "ping" }],
    });
    expect(res.status).toBe(200);
    // egress is anthropic format -> client gets an anthropic-shaped reply
    expect(res.json).toMatchObject({ type: "message", content: [{ type: "text", text: "pong" }] });

    const [url, opts] = requestMock.mock.calls[0]!;
    expect(url).toBe("https://an.test/v1/messages");
    expect((opts as { headers: Record<string, string> }).headers["x-api-key"]).toBe("sk-an");
  });

  it("surfaces an upstream 400 as a GatewayError with the upstream body", async () => {
    requestMock.mockResolvedValue(fakeResponse(400, { error: "bad model" }));
    await expect(
      handle(depsWith(), "openai", { model: "smart", messages: [{ role: "user", content: "x" }] }),
    ).rejects.toBeInstanceOf(GatewayError);
  });

  it("maps a network failure to a 502", async () => {
    requestMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      handle(depsWith(), "openai", { model: "smart", messages: [{ role: "user", content: "x" }] }),
    ).rejects.toMatchObject({ status: 502 });
  });
});
