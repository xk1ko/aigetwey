import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { validateConfig } from "../src/config.js";
import { registerRoutes } from "../src/routes/index.js";
import { GatewayState } from "../src/core/state.js";
import { UsageDB } from "../src/db.js";

/**
 * End-to-end through the REAL gateway pipeline: a Fastify instance with the
 * actual routes/handler/adapters/streaming/fallback, driven by real HTTP
 * requests. Only the upstream providers are faked (we hold no real API keys) —
 * a local http.Server stands in for them and records what it received, so we
 * can assert translation and RTK compression actually reached the wire.
 */

interface Recorded {
  path: string;
  body: unknown;
  authorization?: string;
  xApiKey?: string;
}

let upstream: Server;
let upstreamPort = 0;
let gateway: FastifyInstance;
let gwPort = 0;
const received: Recorded[] = [];
let flakyHits = 0;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

function openAiReply(stream: boolean, res: ServerResponse): void {
  if (!stream) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl-x",
        model: "gpt",
        created: 0,
        choices: [{ index: 0, message: { role: "assistant", content: "hello from openai" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      }),
    );
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  const frames = [
    'data: {"id":"c","model":"gpt","created":0,"choices":[{"index":0,"delta":{"role":"assistant","content":"Hel"},"finish_reason":null}]}\n\n',
    'data: {"id":"c","model":"gpt","created":0,"choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}\n\n',
    'data: {"id":"c","model":"gpt","created":0,"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
    "data: [DONE]\n\n",
  ];
  for (const f of frames) res.write(f);
  res.end();
}

function anthropicReply(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      id: "msg_x",
      model: "claude",
      role: "assistant",
      content: [{ type: "text", text: "hello from anthropic" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 2 },
    }),
  );
}

beforeAll(async () => {
  // ---- fake upstream: path prefix selects provider behavior ----
  upstream = createServer(async (req, res) => {
    const url = req.url ?? "";
    const raw = await readBody(req);
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw;
    }
    received.push({
      path: url,
      body,
      authorization: req.headers["authorization"] as string | undefined,
      xApiKey: req.headers["x-api-key"] as string | undefined,
    });
    const stream = !!(body as { stream?: boolean })?.stream;

    if (url.startsWith("/oa-ok/")) return openAiReply(stream, res);
    if (url.startsWith("/an-ok/")) return anthropicReply(res);
    if (url.startsWith("/flaky/")) {
      flakyHits++;
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "rate limited" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "no such upstream" }));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  upstreamPort = (upstream.address() as { port: number }).port;
  const up = `http://127.0.0.1:${upstreamPort}`;

  // ---- real gateway pointed at the fake upstream ----
  const config = validateConfig({
    server: { api_keys: ["gw-key"] },
    endpoint: { rtk: true },
    providers: [
      { id: "oa-ok", format: "openai", base_url: `${up}/oa-ok/v1`, api_key: "sk-oa", max_retries: 0 },
      { id: "an-ok", format: "anthropic", base_url: `${up}/an-ok/v1`, api_key: "sk-an", max_retries: 0 },
      { id: "flaky", format: "openai", base_url: `${up}/flaky/v1`, api_key: "sk-fl", max_retries: 0 },
    ],
    models: [
      { alias: "smart", target: ["oa-ok"], model: "gpt" },
      { alias: "claude-ish", target: ["an-ok"], model: "claude" },
      { alias: "fb", target: ["flaky", "oa-ok"], model: "gpt" },
    ],
  });

  const dir = mkdtempSync(join(tmpdir(), "aig-e2e-"));
  const state = new GatewayState(join(dir, "config.yaml"), config);
  const db = new UsageDB(":memory:");
  gateway = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });
  registerRoutes(gateway, state, db, "admin-pw");
  await gateway.listen({ host: "127.0.0.1", port: 0 });
  gwPort = (gateway.server.address() as { port: number }).port;
});

afterAll(async () => {
  await gateway.close();
  await new Promise<void>((r) => upstream.close(() => r()));
});

function gwUrl(path: string): string {
  return `http://127.0.0.1:${gwPort}${path}`;
}

describe("E2E — auth gate", () => {
  it("rejects a request with no gateway key", async () => {
    const res = await fetch(gwUrl("/v1/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "smart", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(401);
  });

  it("health is open", async () => {
    const res = await fetch(gwUrl("/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("E2E — OpenAI client → OpenAI provider (passthrough)", () => {
  it("routes and returns the upstream completion", async () => {
    const res = await fetch(gwUrl("/v1/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer gw-key" },
      body: JSON.stringify({ model: "smart", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    expect(json.choices[0]!.message.content).toBe("hello from openai");
    // upstream saw the bearer key from provider config
    const last = received.at(-1)!;
    expect(last.path).toBe("/oa-ok/v1/chat/completions");
    expect(last.authorization).toBe("Bearer sk-oa");
  });
});

describe("E2E — Anthropic client → Anthropic provider", () => {
  it("translates ingress + egress and returns an anthropic-shaped reply", async () => {
    const res = await fetch(gwUrl("/v1/messages"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "gw-key" },
      body: JSON.stringify({ model: "claude-ish", max_tokens: 64, messages: [{ role: "user", content: "ping" }] }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { type: string; content: Array<{ type: string; text: string }> };
    expect(json.type).toBe("message");
    expect(json.content[0]!.text).toBe("hello from anthropic");
    // upstream saw the x-api-key from provider config
    expect(received.at(-1)!.xApiKey).toBe("sk-an");
  });
});

describe("E2E — cross-format streaming (Anthropic client ← OpenAI provider stream)", () => {
  it("renders an OpenAI SSE stream as an Anthropic event sequence", async () => {
    const res = await fetch(gwUrl("/v1/messages"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "gw-key" },
      body: JSON.stringify({ model: "smart", max_tokens: 64, stream: true, messages: [{ role: "user", content: "go" }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    // anthropic event sequence, reassembled text "Hello"
    expect(text).toContain("message_start");
    expect(text).toContain("content_block_delta");
    expect(text).toContain("Hel");
    expect(text).toContain("message_stop");
  });
});

describe("E2E — fallback on 429", () => {
  it("skips the flaky provider and serves from the next in the chain", async () => {
    const before = flakyHits;
    const res = await fetch(gwUrl("/v1/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer gw-key" },
      body: JSON.stringify({ model: "fb", messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    expect(json.choices[0]!.message.content).toBe("hello from openai");
    // the flaky provider was actually hit (429) before falling through
    expect(flakyHits).toBeGreaterThan(before);
    // and the request that won landed on oa-ok
    expect(received.at(-1)!.path).toBe("/oa-ok/v1/chat/completions");
  });
});

describe("E2E — RTK compresses a bulky tool_result before upstream", () => {
  it("the upstream receives a shorter tool message than the client sent", async () => {
    const diffLines = ["diff --git a/big.ts b/big.ts", "@@ -1,300 +1,300 @@"];
    for (let i = 0; i < 300; i++) diffLines.push(`+line ${i} of a very long generated diff hunk`);
    const bigDiff = diffLines.join("\n");

    const res = await fetch(gwUrl("/v1/chat/completions"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer gw-key" },
      body: JSON.stringify({
        model: "smart",
        messages: [
          { role: "user", content: "summarize the diff" },
          { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "git", arguments: "{}" } }] },
          { role: "tool", tool_call_id: "c1", content: bigDiff },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const upstreamBody = received.at(-1)!.body as { messages: Array<{ role: string; content: string }> };
    const toolMsg = upstreamBody.messages.find((m) => m.role === "tool")!;
    // RTK truncated the diff: upstream got far less than the client sent
    expect(toolMsg.content.length).toBeLessThan(bigDiff.length);
    expect(toolMsg.content).toContain("elided by rtk");
  });
});

describe("E2E — admin surface over real HTTP", () => {
  it("usage reflects the requests we just made; admin auth enforced", async () => {
    const noauth = await fetch(gwUrl("/admin/usage"));
    expect(noauth.status).toBe(401);

    const res = await fetch(gwUrl("/admin/usage"), { headers: { authorization: "Bearer admin-pw" } });
    expect(res.status).toBe(200);
    const summary = (await res.json()) as { total: { requests: number } };
    // every successful non-stream + stream request was recorded
    expect(summary.total.requests).toBeGreaterThan(0);
  });

  it("reveals a raw provider/gateway key only with admin auth", async () => {
    const admin = { authorization: "Bearer admin-pw" };

    // config masks the real secret
    const cfg = (await (await fetch(gwUrl("/admin/config"), { headers: admin })).json()) as {
      providers: { id: string; api_key?: string }[];
      server: { api_keys: string[] };
    };
    const masked = cfg.providers.find((p) => p.id === "oa-ok")!.api_key!;
    expect(masked).not.toBe("sk-oa");

    // reveal hands back the real one, but only behind the admin gate
    expect((await fetch(gwUrl("/admin/providers/oa-ok/keys/0/reveal"))).status).toBe(401);
    const provReveal = await fetch(gwUrl("/admin/providers/oa-ok/keys/0/reveal"), { headers: admin });
    expect(provReveal.status).toBe(200);
    expect(((await provReveal.json()) as { key: string }).key).toBe("sk-oa");

    // out-of-range index => 404, not a crash
    expect((await fetch(gwUrl("/admin/providers/oa-ok/keys/9/reveal"), { headers: admin })).status).toBe(404);

    // server key too
    const srvReveal = await fetch(gwUrl("/admin/endpoint/keys/0/reveal"), { headers: admin });
    expect(((await srvReveal.json()) as { key: string }).key).toBe("gw-key");
  });
});
