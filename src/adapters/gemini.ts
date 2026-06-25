/**
 * Google Gemini (generateContent) <-> canonical (OpenAI) translation, non-streaming.
 *
 * Gemini differs structurally from both pivots:
 *  - messages live in `contents: [{ role, parts: [...] }]`, role is user|model
 *  - the system prompt is a separate `systemInstruction`, not a message
 *  - tool calls are `parts: [{ functionCall: { name, args } }]`
 *  - tool results are `parts: [{ functionResponse: { name, response } }]`
 *  - tuning lives under `generationConfig`; usage under `usageMetadata`
 */
import type {
  CanonicalContentPart,
  CanonicalMessage,
  CanonicalRequest,
  CanonicalResponse,
  CanonicalToolCall,
  FinishReason,
} from "../core/canonical.js";

interface GeminiTextPart {
  text: string;
}
interface GeminiInlineDataPart {
  inlineData: { mimeType: string; data: string };
}
interface GeminiFunctionCallPart {
  functionCall: { name: string; args: Record<string, unknown> };
}
interface GeminiFunctionResponsePart {
  functionResponse: { name: string; response: Record<string, unknown> };
}
type GeminiPart =
  | GeminiTextPart
  | GeminiInlineDataPart
  | GeminiFunctionCallPart
  | GeminiFunctionResponsePart;

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiTextPart[] };
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    stopSequences?: string[];
  };
  tools?: Array<{
    functionDeclarations: Array<{
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    }>;
  }>;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { role?: string; parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  modelVersion?: string;
}

const isText = (p: GeminiPart): p is GeminiTextPart => typeof (p as GeminiTextPart).text === "string";
const isCall = (p: GeminiPart): p is GeminiFunctionCallPart => !!(p as GeminiFunctionCallPart).functionCall;
const isResp = (p: GeminiPart): p is GeminiFunctionResponsePart =>
  !!(p as GeminiFunctionResponsePart).functionResponse;

function dataUrlToInline(url: string): GeminiInlineDataPart | null {
  const m = /^data:([^;]+);base64,(.*)$/.exec(url);
  if (!m) return null;
  return { inlineData: { mimeType: m[1]!, data: m[2]! } };
}

function mapFinish(reason: string | undefined): FinishReason {
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
      return "content_filter";
    default:
      return reason ? "stop" : null;
  }
}

// ---------- ingress: Gemini request -> canonical ----------

export function requestToCanonical(body: unknown): CanonicalRequest {
  const req = body as GeminiRequest & { model?: string };
  const messages: CanonicalMessage[] = [];

  const sysText = req.systemInstruction?.parts?.map((p) => p.text).join("\n");
  if (sysText) messages.push({ role: "system", content: sysText });

  for (const c of req.contents ?? []) {
    const textParts: CanonicalContentPart[] = [];
    const toolCalls: CanonicalToolCall[] = [];
    let toolResult: { name: string; content: string } | null = null;

    for (const p of c.parts ?? []) {
      if (isText(p)) textParts.push({ type: "text", text: p.text });
      else if (isCall(p))
        toolCalls.push({
          id: `call_${p.functionCall.name}_${toolCalls.length}`,
          type: "function",
          function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) },
        });
      else if (isResp(p))
        toolResult = {
          name: p.functionResponse.name,
          content: JSON.stringify(p.functionResponse.response ?? {}),
        };
      else if ((p as GeminiInlineDataPart).inlineData) {
        const d = (p as GeminiInlineDataPart).inlineData;
        textParts.push({ type: "image_url", image_url: { url: `data:${d.mimeType};base64,${d.data}` } });
      }
    }

    if (toolResult) {
      messages.push({
        role: "tool",
        tool_call_id: toolResult.name,
        name: toolResult.name,
        content: toolResult.content,
      });
      continue;
    }

    const role = c.role === "model" ? "assistant" : "user";
    const textOnly =
      textParts.length > 0 && textParts.every((p) => p.type === "text")
        ? textParts.map((p) => (p as { text: string }).text).join("")
        : textParts.length > 0
          ? textParts
          : null;
    const msg: CanonicalMessage = { role, content: textOnly };
    if (toolCalls.length > 0) msg.tool_calls = toolCalls;
    if (textOnly !== null || toolCalls.length > 0) messages.push(msg);
  }

  const out: CanonicalRequest = { model: req.model ?? "", messages };
  if (req.generationConfig) {
    const g = req.generationConfig;
    if (g.maxOutputTokens !== undefined) out.max_tokens = g.maxOutputTokens;
    if (g.temperature !== undefined) out.temperature = g.temperature;
    if (g.topP !== undefined) out.top_p = g.topP;
    if (g.stopSequences) out.stop = g.stopSequences;
  }
  const decls = req.tools?.flatMap((t) => t.functionDeclarations ?? []);
  if (decls && decls.length > 0) {
    out.tools = decls.map((d) => ({
      type: "function",
      function: { name: d.name, description: d.description, parameters: d.parameters },
    }));
  }
  return out;
}

// ---------- egress: canonical -> Gemini request ----------

export function requestFromCanonical(req: CanonicalRequest): unknown {
  const contents: GeminiContent[] = [];
  const systemParts: GeminiTextPart[] = [];
  // map tool_call_id -> function name, to label functionResponse
  const idToName = new Map<string, string>();
  for (const m of req.messages) {
    for (const tc of m.tool_calls ?? []) idToName.set(tc.id, tc.function.name);
  }

  for (const m of req.messages) {
    if (m.role === "system") {
      if (typeof m.content === "string" && m.content) systemParts.push({ text: m.content });
      continue;
    }

    if (m.role === "tool") {
      const name = m.name ?? (m.tool_call_id ? idToName.get(m.tool_call_id) : undefined) ?? "tool";
      let response: Record<string, unknown>;
      try {
        const parsed = typeof m.content === "string" ? JSON.parse(m.content) : m.content;
        response =
          parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { result: parsed };
      } catch {
        response = { result: typeof m.content === "string" ? m.content : "" };
      }
      contents.push({ role: "user", parts: [{ functionResponse: { name, response } }] });
      continue;
    }

    const parts: GeminiPart[] = [];
    if (typeof m.content === "string") {
      if (m.content) parts.push({ text: m.content });
    } else if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.type === "text") parts.push({ text: p.text });
        else {
          const inline = dataUrlToInline(p.image_url.url);
          if (inline) parts.push(inline);
        }
      }
    }
    for (const tc of m.tool_calls ?? []) {
      let args: Record<string, unknown> = {};
      try {
        args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        args = {};
      }
      parts.push({ functionCall: { name: tc.function.name, args } });
    }
    if (parts.length > 0) {
      contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
    }
  }

  const out: GeminiRequest = { contents };
  if (systemParts.length > 0) out.systemInstruction = { parts: systemParts };

  const gen: NonNullable<GeminiRequest["generationConfig"]> = {};
  if (req.max_tokens !== undefined) gen.maxOutputTokens = req.max_tokens;
  if (req.temperature !== undefined) gen.temperature = req.temperature;
  if (req.top_p !== undefined) gen.topP = req.top_p;
  if (req.stop !== undefined) gen.stopSequences = Array.isArray(req.stop) ? req.stop : [req.stop];
  if (Object.keys(gen).length > 0) out.generationConfig = gen;

  if (req.tools && req.tools.length > 0) {
    out.tools = [
      {
        functionDeclarations: req.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      },
    ];
  }
  return out;
}

// ---------- response: Gemini reply -> canonical ----------

export function responseToCanonical(resp: unknown): CanonicalResponse {
  const r = resp as GeminiResponse;
  const cand = r.candidates?.[0];
  let text = "";
  const toolCalls: CanonicalToolCall[] = [];

  for (const p of cand?.content?.parts ?? []) {
    if (isText(p)) text += p.text;
    else if (isCall(p))
      toolCalls.push({
        id: `call_${p.functionCall.name}_${toolCalls.length}`,
        type: "function",
        function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) },
      });
  }

  const message: CanonicalMessage = { role: "assistant", content: text || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  const u = r.usageMetadata;
  return {
    id: "gemini",
    model: r.modelVersion ?? "",
    created: 0,
    choices: [
      {
        index: 0,
        message,
        finish_reason: toolCalls.length > 0 ? "tool_calls" : mapFinish(cand?.finishReason),
      },
    ],
    usage: u
      ? {
          prompt_tokens: u.promptTokenCount ?? 0,
          completion_tokens: u.candidatesTokenCount ?? 0,
          total_tokens: (u.promptTokenCount ?? 0) + (u.candidatesTokenCount ?? 0),
          cached_tokens: u.cachedContentTokenCount,
          reasoning_tokens: u.thoughtsTokenCount,
        }
      : undefined,
  };
}

// ---------- response: canonical -> Gemini reply ----------

function reverseFinish(reason: FinishReason): string {
  switch (reason) {
    case "length":
      return "MAX_TOKENS";
    case "content_filter":
      return "SAFETY";
    default:
      return "STOP";
  }
}

export function responseFromCanonical(resp: CanonicalResponse): unknown {
  const choice = resp.choices[0];
  const msg = choice?.message;
  const parts: GeminiPart[] = [];

  if (msg) {
    if (typeof msg.content === "string" && msg.content) parts.push({ text: msg.content });
    else if (Array.isArray(msg.content))
      for (const p of msg.content) if (p.type === "text") parts.push({ text: p.text });
    for (const tc of msg.tool_calls ?? []) {
      let args: Record<string, unknown> = {};
      try {
        args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        args = {};
      }
      parts.push({ functionCall: { name: tc.function.name, args } });
    }
  }

  return {
    candidates: [
      { content: { role: "model", parts }, finishReason: reverseFinish(choice?.finish_reason ?? null), index: 0 },
    ],
    usageMetadata: {
      promptTokenCount: resp.usage?.prompt_tokens ?? 0,
      candidatesTokenCount: resp.usage?.completion_tokens ?? 0,
      totalTokenCount: resp.usage?.total_tokens ?? 0,
    },
    modelVersion: resp.model,
  };
}
