/**
 * Mutable holder for the live gateway config, key pool, and quota tracker.
 *
 * Config loads once at boot, but the dashboard edits it at runtime. Routes read
 * `state.config` / `state.pool` / `state.quota` fresh per request (never close
 * over them), so a successful reload swaps in the new config + pool atomically —
 * no restart.
 *
 * reload() validates and persists BEFORE swapping: an invalid edit throws and
 * the old config keeps serving. The pool is rebuilt (cooldown is transient), but
 * the quota tracker is KEPT across reloads — a budget consumed this window must
 * survive a config edit, else editing config would silently reset every quota.
 */
import {
  GatewayConfig,
  parseConfigText,
  validateConfig,
  unmaskSecrets,
  writeConfigFile,
} from "../config.js";
import { KeyPool } from "./keypool.js";
import { QuotaTracker } from "./quota.js";
import { BudgetTracker } from "./budget.js";

export class GatewayState {
  private _config: GatewayConfig;
  private _pool: KeyPool;
  private readonly _quota: QuotaTracker;
  private readonly _budget: BudgetTracker;

  constructor(
    private readonly configPath: string,
    initial: GatewayConfig,
    quota?: QuotaTracker,
    budgetDb?: { summary(since: number): { total: { tokens_in: number; tokens_out: number; cost: number } } },
  ) {
    this._config = initial;
    this._pool = new KeyPool();
    this._quota = quota ?? new QuotaTracker();
    this._budget = new BudgetTracker(() => this._config.raw.budget, budgetDb ?? { summary: () => ({ total: { tokens_in: 0, tokens_out: 0, cost: 0 } }) });
  }

  get config(): GatewayConfig {
    return this._config;
  }

  get pool(): KeyPool {
    return this._pool;
  }

  get quota(): QuotaTracker {
    return this._quota;
  }

  get budget(): BudgetTracker {
    return this._budget;
  }

  /**
   * Validate edited config text, restore masked secrets from the live config,
   * persist atomically, then swap in a fresh config + pool. Throws without
   * changing anything if validation fails or a masked key can't be resolved —
   * the old config keeps serving. The quota tracker is intentionally preserved.
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
