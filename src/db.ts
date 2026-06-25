/**
 * Usage tracking store, backed by the built-in node:sqlite (no native build).
 * One `usage` row per upstream request that produced usage; an optional `logs`
 * table holds request/response summaries for debugging. Unified under DATA_DIR
 * (default ./data).
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";

// node:sqlite is a recent builtin; require it dynamically so bundlers/test
// transformers that don't yet know the `node:sqlite` specifier don't choke.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof import("node:sqlite").DatabaseSync;
};
type DatabaseSync = import("node:sqlite").DatabaseSync;

export interface UsageRow {
  ts: number;
  alias: string;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cached_tokens: number;
  cost: number;
  status: number;
  latency_ms: number;
  stream: number; // 0/1
  client_key: string;
}

export interface LogRow {
  ts: number;
  direction: string; // "ingress" | "egress" | "error"
  provider: string;
  status: number;
  request_summary: string;
  response_summary: string;
}

export interface UsageTotals {
  tokens_in: number;
  tokens_out: number;
  cost: number;
}

export interface UsageSummary {
  total: { requests: number; tokens_in: number; tokens_out: number; cost: number };
  by_provider: Array<{ provider: string; requests: number; tokens_in: number; tokens_out: number; cost: number }>;
  by_model: Array<{ alias: string; model: string; requests: number; tokens_in: number; tokens_out: number; cost: number }>;
}

export interface UsageSeriesPoint {
  ts: number;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  cost: number;
}

// node:sqlite returns loosely-typed rows; this alias documents the cast site.
type SqlRow = Record<string, unknown>;
const num = (v: unknown): number => Number(v ?? 0);

export class UsageDB {
  private readonly db: DatabaseSync;
  private readonly insertUsage;
  private readonly insertLog;
  private readonly now: () => number;

  constructor(path: string, now: () => number = Date.now) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        alias TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0,
        status INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        stream INTEGER NOT NULL DEFAULT 0,
        client_key TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage(ts);
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        direction TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT '',
        status INTEGER NOT NULL DEFAULT 0,
        request_summary TEXT NOT NULL DEFAULT '',
        response_summary TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);
      CREATE TABLE IF NOT EXISTS quota_state (
        provider_id TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        consumed INTEGER NOT NULL DEFAULT 0,
        last_reset INTEGER NOT NULL DEFAULT 0
      );
    `);
    // migrate older DBs created before client_key existed.
    const cols = this.db.prepare(`PRAGMA table_info(usage)`).all() as SqlRow[];
    if (!cols.some((c) => String(c.name) === "client_key")) {
      this.db.exec(`ALTER TABLE usage ADD COLUMN client_key TEXT NOT NULL DEFAULT ''`);
    }
    this.now = now;
    this.insertUsage = this.db.prepare(`
      INSERT INTO usage (ts, alias, provider, model, tokens_in, tokens_out, cached_tokens, cost, status, latency_ms, stream, client_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.insertLog = this.db.prepare(`
      INSERT INTO logs (ts, direction, provider, status, request_summary, response_summary)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
  }

  record(row: Omit<UsageRow, "ts" | "client_key"> & { ts?: number; client_key?: string }): void {
    this.insertUsage.run(
      row.ts ?? this.now(),
      row.alias,
      row.provider,
      row.model,
      row.tokens_in,
      row.tokens_out,
      row.cached_tokens,
      row.cost,
      row.status,
      row.latency_ms,
      row.stream,
      row.client_key ?? "",
    );
  }

  log(row: Omit<LogRow, "ts"> & { ts?: number }): void {
    this.insertLog.run(
      row.ts ?? this.now(),
      row.direction,
      row.provider,
      row.status,
      row.request_summary,
      row.response_summary,
    );
  }

  /** Summary over rows with ts >= sinceMs (default: all time). */
  summary(sinceMs = 0): UsageSummary {
    const total = this.db
      .prepare(
        `SELECT COUNT(*) requests, COALESCE(SUM(tokens_in),0) tokens_in,
                COALESCE(SUM(tokens_out),0) tokens_out, COALESCE(SUM(cost),0) cost
         FROM usage WHERE ts >= ?`,
      )
      .get(sinceMs) as SqlRow;

    const by_provider = this.db
      .prepare(
        `SELECT provider, COUNT(*) requests, COALESCE(SUM(tokens_in),0) tokens_in,
                COALESCE(SUM(tokens_out),0) tokens_out, COALESCE(SUM(cost),0) cost
         FROM usage WHERE ts >= ? GROUP BY provider ORDER BY cost DESC`,
      )
      .all(sinceMs) as SqlRow[];

    const by_model = this.db
      .prepare(
        `SELECT alias, model, COUNT(*) requests, COALESCE(SUM(tokens_in),0) tokens_in,
                COALESCE(SUM(tokens_out),0) tokens_out, COALESCE(SUM(cost),0) cost
         FROM usage WHERE ts >= ? GROUP BY alias, model ORDER BY cost DESC`,
      )
      .all(sinceMs) as SqlRow[];

    return {
      total: {
        requests: num(total.requests),
        tokens_in: num(total.tokens_in),
        tokens_out: num(total.tokens_out),
        cost: num(total.cost),
      },
      by_provider: by_provider.map((r) => ({
        provider: String(r.provider),
        requests: num(r.requests),
        tokens_in: num(r.tokens_in),
        tokens_out: num(r.tokens_out),
        cost: num(r.cost),
      })),
      by_model: by_model.map((r) => ({
        alias: String(r.alias),
        model: String(r.model),
        requests: num(r.requests),
        tokens_in: num(r.tokens_in),
        tokens_out: num(r.tokens_out),
        cost: num(r.cost),
      })),
    };
  }

  /**
   * Summed token + cost totals over rows with ts >= sinceMs, optionally filtered
   * to one provider and/or one model. Backs the scoped budget tracker — the usage
   * table stays the single source of truth (no parallel counter).
   */
  totals(sinceMs: number, filter?: { provider?: string; model?: string; client_key?: string }): UsageTotals {
    const clauses = ["ts >= ?"];
    const params: Array<number | string> = [sinceMs];
    if (filter?.provider) {
      clauses.push("provider = ?");
      params.push(filter.provider);
    }
    if (filter?.model) {
      clauses.push("model = ?");
      params.push(filter.model);
    }
    if (filter?.client_key) {
      clauses.push("client_key = ?");
      params.push(filter.client_key);
    }
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(tokens_in),0) tokens_in, COALESCE(SUM(tokens_out),0) tokens_out,
                COALESCE(SUM(cost),0) cost
         FROM usage WHERE ${clauses.join(" AND ")}`,
      )
      .get(...params) as SqlRow;
    return { tokens_in: num(row.tokens_in), tokens_out: num(row.tokens_out), cost: num(row.cost) };
  }

  /**
   * Bucketed time-series for charts: one point per `bucketMs` interval from
   * `sinceMs` to now, aligned to the bucket boundary, with zero-filled gaps.
   */
  series(sinceMs: number, bucketMs: number): UsageSeriesPoint[] {
    const now = this.now();
    const start = Math.floor(sinceMs / bucketMs) * bucketMs;
    const rows = this.db
      .prepare(
        `SELECT CAST(ts / ? AS INTEGER) * ? AS bucket, COUNT(*) requests,
                COALESCE(SUM(tokens_in),0) tokens_in,
                COALESCE(SUM(tokens_out),0) tokens_out, COALESCE(SUM(cost),0) cost
         FROM usage WHERE ts >= ? GROUP BY bucket ORDER BY bucket`,
      )
      .all(bucketMs, bucketMs, sinceMs) as SqlRow[];

    const byBucket = new Map<number, SqlRow>();
    for (const r of rows) byBucket.set(num(r.bucket), r);

    const out: UsageSeriesPoint[] = [];
    for (let t = start; t <= now; t += bucketMs) {
      const r = byBucket.get(t);
      out.push({
        ts: t,
        requests: r ? num(r.requests) : 0,
        tokens_in: r ? num(r.tokens_in) : 0,
        tokens_out: r ? num(r.tokens_out) : 0,
        cost: r ? num(r.cost) : 0,
      });
    }
    return out;
  }

  /** Most recent usage rows, newest first. For the dashboard logs page. */
  recent(limit = 100): UsageRow[] {
    const rows = this.db
      .prepare(
        `SELECT ts, alias, provider, model, tokens_in, tokens_out, cached_tokens,
                cost, status, latency_ms, stream, client_key
         FROM usage ORDER BY id DESC LIMIT ?`,
      )
      .all(Math.max(1, Math.min(limit, 1000))) as SqlRow[];
    return rows.map((r) => ({
      ts: num(r.ts),
      alias: String(r.alias),
      provider: String(r.provider),
      model: String(r.model),
      tokens_in: num(r.tokens_in),
      tokens_out: num(r.tokens_out),
      cached_tokens: num(r.cached_tokens),
      cost: num(r.cost),
      status: num(r.status),
      latency_ms: num(r.latency_ms),
      stream: num(r.stream),
      client_key: String(r.client_key ?? ""),
    }));
  }

  close(): void {
    this.db.close();
  }
}

/** Compute USD cost from token counts and per-1M prices. */
export function computeCost(tokensIn: number, tokensOut: number, priceIn?: number, priceOut?: number): number {
  const ci = priceIn ? (tokensIn / 1_000_000) * priceIn : 0;
  const co = priceOut ? (tokensOut / 1_000_000) * priceOut : 0;
  return ci + co;
}
