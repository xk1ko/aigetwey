/**
 * Anthropic Messages API <-> canonical (OpenAI) translation, non-streaming.
 *
 *  - requestToCanonical:    client speaks Anthropic   -> canonical   (ingress)
 *  - requestFromCanonical:  canonical -> Anthropic provider          (egress)
 *  - responseToCanonical:   Anthropic provider reply  -> canonical
 *  - responseFromCanonical: canonical -> Anthropic client reply
 */
import type {
  CanonicalContentPart,
  CanonicalMessage,
  CanonicalRequest,
  CanonicalResponse,
  CanonicalToolCall,
  CanonicalToolDef,
  FinishReason,
} from "../core/canonical.js";

const TOOL_ID_RE = /^[a-zA-Z0-9_-]+$/;

/** Anthropic requires tool ids match ^[a-zA-Z0-9_-]+$; coerce if needed. */
function sanitizeToolId(id: string, fallback: string): string {
  if (id && TOOL_ID_RE.test(id)) return id;
  const cleaned = (id || "").replace(/[^a-zA-Z0-9_-]/g, "");
  return cleaned || fallback;
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
}
interface AnthropicImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}
interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}
type AnthropicBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicBlock[];
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicTextBlock[];
  max_tokens: number;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  tools?: Array<{ name: string; description?: string; input_schema: Record<string, unknown> }>;
  tool_choice?: unknown;
}

// ---------- ingress: Anthropic request -> canonical ----------

function systemToMessage(system: AnthropicRequest["system"]): CanonicalMessage | null {
  if (!system) return null;
  const text = typeof system === "string" ? system : system.map((b) => b.text).join("\n");
  if (!text) return null;
  return { role: "system", content: text };
}

function anthropicContentToCanonical(content: string | AnthropicBlock[]): {
  parts: string | CanonicalContentPart[] | null;
  toolCalls: CanonicalToolCall[];
  toolResults: Array<{ id: string; content: string }>;
} {
  if (typeof content === "string") {
    return { parts: content, toolCalls: [], toolResults: [] };
  }

  const parts: CanonicalContentPart[] = [];
  const toolCalls: CanonicalToolCall[] = [];
  const toolResults: Array<{ id: string; content: string }> = [];

  for (const block of content) {
    switch (block.type) {
      case "text":
        parts.push({ type: "text", text: block.text });
        break;
      case "image":
        parts.push({
          type: "image_url",
          image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
        });
        break;
      case "tool_use":
        toolCalls.push({
          id: block.id,
          type: "function",
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
        });
        break;
      case "tool_result": {
        const text =
          typeof block.content === "string"
            ? block.content
            : block.content.map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("");
        toolResults.push({ id: block.tool_use_id, content: text });
        break;
      }
    }
  }

  const textOnly =
    parts.length > 0 && parts.every((p) => p.type === "text")
      ? parts.map((p) => (p as CanonicalTextPartLike).text).join("")
      : parts.length > 0
        ? parts
        : null;

  return { parts: textOnly, toolCalls, toolResults };
}

type CanonicalTextPartLike = { text: string };

export function requestToCanonical(body: unknown): CanonicalRequest {
  const req = body as AnthropicRequest;
  const messages: CanonicalMessage[] = [];

  const sys = systemToMessage(req.system);
  if (sys) messages.push(sys);

  for (const m of req.messages) {
    const { parts, toolCalls, toolResults } = anthropicContentToCanonical(m.content);

    // tool_result blocks become separate role="tool" messages
    for (const tr of toolResults) {
      messages.push({ role: "tool", tool_call_id: tr.id, content: tr.content });
    }

    if (m.role === "assistant") {
      const msg: CanonicalMessage = { role: "assistant", content: parts };
      if (toolCalls.length > 0) msg.tool_calls = toolCalls;
      if (parts !== null || toolCalls.length > 0) messages.push(msg);
    } else if (parts !== null) {
      messages.push({ role: "user", content: parts });
    }
  }

  const tools: CanonicalToolDef[] | undefined = req.tools?.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));

  const canonical: CanonicalRequest = {
    model: req.model,
    messages,
    stream: req.stream,
    max_tokens: req.max_tokens,
  };
  if (req.temperature !== undefined) canonical.temperature = req.temperature;
  if (req.top_p !== undefined) canonical.top_p = req.top_p;
  if (req.stop_sequences) canonical.stop = req.stop_sequences;
  if (tools) canonical.tools = tools;
  if (req.tool_choice !== undefined) canonical.tool_choice = req.tool_choice;

  return canonical;
}

// ---------- egress: canonical -> Anthropic request ----------

function canonicalContentToBlocks(content: CanonicalMessage["content"]): AnthropicBlock[] {
  if (content === null) return [];
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  return content.map((p): AnthropicBlock => {
    if (p.type === "text") return { type: "text", text: p.text };
    const m = /^data:([^;]+);base64,(.*)$/.exec(p.image_url.url);
    if (m) return { type: "image", source: { type: "base64", media_type: m[1]!, data: m[2]! } };
    return { type: "text", text: "" };
  });
}

export function requestFromCanonical(req: CanonicalRequest): unknown {
  const systemParts: string[] = [];
  const messages: AnthropicMessage[] = [];

  for (const m of req.messages) {
    if (m.role === "system") {
      if (typeof m.content === "string") systemParts.push(m.content);
      continue;
    }
    if (m.role === "tool") {
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.tool_call_id ?? "",
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          },
        ],
      });
      continue;
    }

    const blocks = canonicalContentToBlocks(m.content);
    if (m.role === "assistant" && m.tool_calls) {
      for (let i = 0; i < m.tool_calls.length; i++) {
        const tc = m.tool_calls[i]!;
        let input: unknown = {};
        try {
          input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          input = {};
        }
        blocks.push({ type: "tool_use", id: sanitizeToolId(tc.id, `call_${i}`), name: tc.function.name, input });
      }
    }
    if (blocks.length > 0) {
      messages.push({ role: m.role as "user" | "assistant", content: blocks });
    }
  }

  const out: AnthropicRequest = {
    model: req.model,
    messages,
    max_tokens: req.max_tokens ?? 4096,
  };
  if (systemParts.length > 0) out.system = systemParts.join("\n");
  if (req.temperature !== undefined) out.temperature = req.temperature;
  if (req.top_p !== undefined) out.top_p = req.top_p;
  if (req.stop !== undefined) out.stop_sequences = Array.isArray(req.stop) ? req.stop : [req.stop];
  if (req.stream !== undefined) out.stream = req.stream;
  if (req.tools) {
    out.tools = req.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters ?? { type: "object", properties: {} },
    }));
  }
  if (req.tool_choice !== undefined) out.tool_choice = req.tool_choice;

  return out;
}

// ---------- response: Anthropic reply -> canonical ----------

interface AnthropicResponse {
  id: string;
  model: string;
  role: "assistant";
  content: Array<AnthropicTextBlock | AnthropicToolUseBlock>;
  stop_reason: string | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

function mapStopReason(reason: string | null): FinishReason {
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

export function responseToCanonical(resp: unknown): CanonicalResponse {
  const r = resp as AnthropicResponse;
  let text = "";
  const toolCalls: CanonicalToolCall[] = [];

  for (const block of r.content ?? []) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
  }

  const message: CanonicalMessage = { role: "assistant", content: text || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  return {
    id: r.id,
    model: r.model,
    created: 0,
    choices: [{ index: 0, message, finish_reason: mapStopReason(r.stop_reason) }],
    usage: r.usage
      ? {
          prompt_tokens:
            (r.usage.input_tokens ?? 0) +
            (r.usage.cache_read_input_tokens ?? 0) +
            (r.usage.cache_creation_input_tokens ?? 0),
          completion_tokens: r.usage.output_tokens,
          total_tokens:
            (r.usage.input_tokens ?? 0) +
            (r.usage.cache_read_input_tokens ?? 0) +
            (r.usage.cache_creation_input_tokens ?? 0) +
            (r.usage.output_tokens ?? 0),
          cached_tokens: r.usage.cache_read_input_tokens,
          cache_creation_tokens: r.usage.cache_creation_input_tokens,
        }
      : undefined,
  };
}

// ---------- response: canonical -> Anthropic reply ----------

function reverseStopReason(reason: FinishReason): string | null {
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

export function responseFromCanonical(resp: CanonicalResponse): unknown {
  const choice = resp.choices[0];
  const msg = choice?.message;
  const content: Array<AnthropicTextBlock | AnthropicToolUseBlock> = [];

  if (msg) {
    if (typeof msg.content === "string" && msg.content) {
      content.push({ type: "text", text: msg.content });
    } else if (Array.isArray(msg.content)) {
      for (const p of msg.content) if (p.type === "text") content.push({ type: "text", text: p.text });
    }
    if (msg.tool_calls) {
      for (let i = 0; i < msg.tool_calls.length; i++) {
        const tc = msg.tool_calls[i]!;
        let input: unknown = {};
        try {
          input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          input = {};
        }
        content.push({ type: "tool_use", id: sanitizeToolId(tc.id, `call_${i}`), name: tc.function.name, input });
      }
    }
  }

  return {
    id: resp.id,
    type: "message",
    role: "assistant",
    model: resp.model,
    content,
    stop_reason: reverseStopReason(choice?.finish_reason ?? null),
    stop_sequence: null,
    usage: {
      input_tokens: resp.usage?.prompt_tokens ?? 0,
      output_tokens: resp.usage?.completion_tokens ?? 0,
      ...(resp.usage?.cached_tokens !== undefined
        ? { cache_read_input_tokens: resp.usage.cached_tokens }
        : {}),
    },
  };
}
