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

export const consoleBuffer = new ConsoleBuffer();
export type { LogEntry, LogLevel };
