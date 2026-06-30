import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock undici.request so the handler can be exercised without a network call.
const requestMock = vi.fn();
vi.mock("undici", () => ({ request: (...args: unknown[]) => requestMock(...args) }));

import { handle, GatewayError, type HandleDeps } from "../src/core/handler.js";
import { validateConfig } from "../src/config.js";
import { KeyPool } from "../src/core/keypool.js";
import { UsageDB } from "../src/db.js";

function depsWith(db?: UsageDB): HandleDeps {
  const config = validateConfig({
    providers: [
      { id: "oa", format: "openai", base_url: "https://oa.test/v1", api_key: "sk-oa" },
      { id: "an", format: "anthropic", base_url: "https://an.test/v1", api_key: "sk-an" },
    ],
    models: [
      { alias: "smart", target: ["oa"], model: "gpt-4o", price_in: 3, price_out: 15 },
      { alias: "claude-ish", target: ["an"], model: "claude-3" },
    ],
  });
  return { config, pool: new KeyPool(), db };
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

  it("records usage with computed cost on a successful non-stream request", async () => {
    const upstreamJson = {
      id: "chatcmpl-1",
      model: "gpt-4o",
      created: 1,
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
    };
    requestMock.mockResolvedValue(fakeResponse(200, upstreamJson));
    const db = new UsageDB(":memory:");

    await handle(depsWith(db), "openai", { model: "smart", messages: [{ role: "user", content: "hi" }] });

    const rows = db.recent(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ alias: "smart", provider: "oa", model: "gpt-4o", tokens_in: 1_000_000, tokens_out: 1_000_000, stream: 0 });
    // price_in 3 + price_out 15 over 1M each => 18
    expect(rows[0]!.cost).toBeCloseTo(18);
  });
});

describe("scoped budget hard-stop", () => {
  const globalExhausted = { globalStatus: () => ({ exhausted: true, reset_in_ms: 1234 }), blocks: () => null, blocksKey: () => null };
  const noBudget = { globalStatus: () => null, blocks: () => null, blocksKey: () => null };

  it("402 when the global budget is exhausted", async () => {
    const deps = { ...depsWith(), budget: globalExhausted };
    await expect(
      handle(deps, "openai", { model: "smart", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ status: 402, payload: { error: { message: expect.stringContaining("budget exceeded"), reset_in_ms: 1234 } } });
  });

  it("402 when all routes are blocked by scoped budgets", async () => {
    const allBlocked = {
      globalStatus: () => null,
      blocks: () => ({ exhausted: true as const, reset_in_ms: 777 }),
      blocksKey: () => null,
    };
    const deps = { ...depsWith(), budget: allBlocked };
    await expect(
      handle(deps, "openai", { model: "smart", messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ status: 402, payload: { error: { message: expect.stringContaining("budget exceeded"), reset_in_ms: 777 } } });
  });

  it("200 when only the first provider is blocked and fallback serves an unblocked route", async () => {
    // Two OpenAI-format providers, alias "multi" targeting both.
    const multiConfig = validateConfig({
      providers: [
        { id: "blocked-oa", format: "openai", base_url: "https://blocked.test/v1", api_key: "sk-b" },
        { id: "good-oa", format: "openai", base_url: "https://good.test/v1", api_key: "sk-g" },
      ],
      models: [{ alias: "multi", target: ["blocked-oa", "good-oa"], model: "gpt-4o", price_in: 3, price_out: 15 }],
    });
    const upstreamJson = {
      id: "chatcmpl-1",
      model: "gpt-4o",
      created: 1,
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    };
    requestMock.mockResolvedValue(fakeResponse(200, upstreamJson));

    const partialBlock = {
      globalStatus: () => null,
      blocks: (providerId: string, _model: string) =>
        providerId === "blocked-oa" ? { exhausted: true as const, reset_in_ms: 500 } : null,
      blocksKey: () => null,
    };
    const deps: HandleDeps = { config: multiConfig, pool: new KeyPool(), budget: partialBlock };
    const res = await handle(deps, "openai", { model: "multi", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);

    // Verify the request went to the unblocked provider, not the blocked one.
    const [url] = requestMock.mock.calls[0]!;
    expect(url).toBe("https://good.test/v1/chat/completions");
  });

  it("passes through when no budget blocks", async () => {
    const upstreamJson = {
      id: "chatcmpl-1",
      model: "gpt-4o",
      created: 1,
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    };
    requestMock.mockResolvedValue(fakeResponse(200, upstreamJson));

    const deps = { ...depsWith(), budget: noBudget };
    const res = await handle(deps, "openai", { model: "smart", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
  });
});

describe("per-key model allowlist", () => {
  it("403s when the requested model is not in the key's allowlist", async () => {
    const deps = { ...depsWith(), clientKeyModels: ["some-other-model"] };
    await expect(
      handle(deps, "openai", { model: "smart", messages: [] }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("allows a model that IS in the allowlist", async () => {
    const upstreamJson = {
      id: "chatcmpl-1",
      model: "gpt-4o",
      created: 1,
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    };
    requestMock.mockResolvedValue(fakeResponse(200, upstreamJson));
    const deps = { ...depsWith(), clientKeyModels: ["smart"] };
    const res = await handle(deps, "openai", { model: "smart", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
  });

  it("does not restrict when the allowlist is absent or empty", async () => {
    const upstreamJson = {
      id: "chatcmpl-1",
      model: "gpt-4o",
      created: 1,
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    };
    requestMock.mockResolvedValue(fakeResponse(200, upstreamJson));

    // empty array
    const deps1 = { ...depsWith(), clientKeyModels: [] as string[] };
    const res1 = await handle(deps1, "openai", { model: "smart", messages: [{ role: "user", content: "hi" }] });
    expect(res1.status).toBe(200);

    // absent (undefined)
    const deps2 = depsWith();
    const res2 = await handle(deps2, "openai", { model: "smart", messages: [{ role: "user", content: "hi" }] });
    expect(res2.status).toBe(200);
  });
});

describe("per-key budget hard-stop", () => {
  const keyBlocked = { globalStatus: () => null, blocks: () => null, blocksKey: (fp: string) => (fp === "aaaa1111" ? { exhausted: true as const, reset_in_ms: 42 } : null) };
  it("402 when the caller key is over budget", async () => {
    const deps = { ...depsWith(), budget: keyBlocked, clientKeyFp: "aaaa1111" };
    await expect(handle(deps, "openai", { model: "smart", messages: [{ role: "user", content: "hi" }] }))
      .rejects.toMatchObject({ status: 402, payload: { error: { message: expect.stringContaining("budget exceeded"), reset_in_ms: 42 } } });
  });
  it("passes a different key through", async () => {
    const upstreamJson = {
      id: "chatcmpl-1",
      model: "gpt-4o",
      created: 1,
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    };
    requestMock.mockResolvedValue(fakeResponse(200, upstreamJson));
    const deps = { ...depsWith(), budget: keyBlocked, clientKeyFp: "bbbb2222" };
    const res = await handle(deps, "openai", { model: "smart", messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
  });
});
