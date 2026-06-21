/**
 * Minimal SSE (Server-Sent Events) parsing & serialization.
 *
 * Providers stream `data: {...}\n\n` frames (Anthropic also sets `event: <type>`).
 * Parse a byte stream into events, let a translator transform them, re-serialize.
 * Parsing is incremental: provider chunks may split mid-frame.
 */

export interface SSEEvent {
  /** the `event:` field, if present (Anthropic uses it; OpenAI does not) */
  event?: string;
  /** the `data:` payload, raw string (may be `[DONE]`) */
  data: string;
}

/** Parse a (possibly chunked) byte stream into SSE events. */
export async function* parseSSE(stream: AsyncIterable<Uint8Array>): AsyncGenerator<SSEEvent> {
  const decoder = new TextDecoder();
  let buf = "";

  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });

    let sep: number;
    // frames are separated by a blank line (\n\n)
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const ev = parseFrame(frame);
      if (ev) yield ev;
    }
  }

  // flush a trailing frame that lacked the terminator
  const tail = buf.trim();
  if (tail) {
    const ev = parseFrame(tail);
    if (ev) yield ev;
  }
}

function parseFrame(frame: string): SSEEvent | null {
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const rawLine of frame.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line || line.startsWith(":")) continue; // comment / empty
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
  }

  if (dataLines.length === 0 && event === undefined) return null;
  return { event, data: dataLines.join("\n") };
}

/** Serialize an event to an SSE frame string. */
export function serializeSSE(ev: SSEEvent): string {
  let out = "";
  if (ev.event) out += `event: ${ev.event}\n`;
  out += `data: ${ev.data}\n\n`;
  return out;
}

export function encodeSSE(ev: SSEEvent): Uint8Array {
  return new TextEncoder().encode(serializeSSE(ev));
}
