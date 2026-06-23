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
    for (const fn of this.listeners) fn(entry);
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
