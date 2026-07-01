type LogLevel = "LOG" | "INFO" | "WARN" | "ERROR" | "DEBUG";

interface LogEntry {
  ts: number;
  level: LogLevel;
  message: string;
}

type Listener = (entry: LogEntry) => void;

const MAX_ENTRIES = 500;

class ConsoleBuffer {
  private entries: LogEntry[] = [];
  private listeners = new Set<Listener>();

  push(level: LogLevel, message: string): void {
    const entry: LogEntry = { ts: Date.now(), level, message };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    // A subscriber (the SSE console-stream) can be writing to an already-dead
    // connection if its cancel() didn't fire on disconnect — isolate that so
    // one stale listener can't throw out of push() and break every other
    // caller's log() on the next line of business logic. Self-heals: a
    // listener that throws is proven dead, so drop it instead of throwing on
    // every future push() too.
    for (const fn of this.listeners) {
      try {
        fn(entry);
      } catch {
        this.listeners.delete(fn);
      }
    }
  }

  recent(): LogEntry[] {
    return this.entries.slice();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  clear(): void {
    this.entries = [];
  }
}

// Anchored on globalThis (not a plain module-level const) so Next.js dev-mode
// HMR — which re-evaluates modules under the @/gw/* alias when dist/ changes —
// doesn't reset it and silently drop the whole log history. Same pattern as
// gw()'s singleton in dashboard/src/lib/gw.ts.
declare global {
  var __aigloo_console_buffer: ConsoleBuffer | undefined;
}

export const consoleBuffer = globalThis.__aigloo_console_buffer ?? (globalThis.__aigloo_console_buffer = new ConsoleBuffer());
export type { LogEntry, LogLevel };
