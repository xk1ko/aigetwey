/**
 * Mutable holder for the live gateway config, key pool, and budget tracker.
 *
 * Config loads once at boot, but the dashboard edits it at runtime. Routes read
 * `state.config` / `state.pool` / `state.budget` fresh per request (never close
 * over them), so a successful reload swaps in the new config + pool atomically —
 * no restart.
 *
 * reload() validates and persists BEFORE swapping: an invalid edit throws and
 * the old config keeps serving. The pool is rebuilt (cooldown is transient).
 */
import {
  GatewayConfig,
  parseConfigText,
  validateConfig,
  unmaskSecrets,
  writeConfigFile,
  maskKey,
} from "../config.js";
import { clientKeyFingerprint } from "../middleware/auth.js";
import { KeyPool } from "./keypool.js";
import { BudgetTracker } from "./budget.js";

function serverKeyLabel(server: { api_keys: string[]; key_names?: Record<string, string> }, fp: string): string {
  for (const k of server.api_keys) {
    if (clientKeyFingerprint(k) === fp) return server.key_names?.[k] ?? maskKey(k);
  }
  return `key …${fp}`;
}

export class GatewayState {
  private _config: GatewayConfig;
  private _pool: KeyPool;
  private readonly _budget: BudgetTracker;

  constructor(
    private readonly configPath: string,
    initial: GatewayConfig,
    budgetDb?: { totals(since: number, filter?: { provider?: string; model?: string; client_key?: string }): { tokens_in: number; tokens_out: number; cost: number } },
  ) {
    this._config = initial;
    this._pool = new KeyPool();
    this._budget = new BudgetTracker(
      () => this._config.raw.budgets,
      budgetDb ?? { totals: () => ({ tokens_in: 0, tokens_out: 0, cost: 0 }) },
      undefined,
      undefined,
      (fp) => serverKeyLabel(this._config.raw.server, fp),
    );
  }

  get config(): GatewayConfig {
    return this._config;
  }

  get pool(): KeyPool {
    return this._pool;
  }

  get budget(): BudgetTracker {
    return this._budget;
  }

  /**
   * Validate edited config text, restore masked secrets from the live config,
   * persist atomically, then swap in a fresh config + pool. Throws without
   * changing anything if validation fails or a masked key can't be resolved —
   * the old config keeps serving.
   */
  reload(text: string): void {
    const parsed = parseConfigText(text);
    const merged = unmaskSecrets(parsed.raw, this._config.raw);
    const next = validateConfig(merged);
    writeConfigFile(this.configPath, next.raw);
    this._config = next;
    this._pool = new KeyPool();
    this._budget.clearCache();
  }
}
