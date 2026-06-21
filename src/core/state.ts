/**
 * Mutable holder for the live gateway config and its key pool.
 *
 * Config loads once at boot, but the dashboard edits it at runtime. Routes read
 * `state.config` / `state.pool` fresh per request (never close over them), so a
 * successful reload swaps in the new config + pool atomically — no restart.
 *
 * reload() validates and persists BEFORE swapping: an invalid edit throws and
 * the old config keeps serving. Rebuilding the pool resets cooldown state, which
 * is acceptable since config edits are rare.
 */
import {
  GatewayConfig,
  parseConfigText,
  validateConfig,
  unmaskSecrets,
  writeConfigFile,
} from "../config.js";
import { KeyPool } from "./keypool.js";

export class GatewayState {
  private _config: GatewayConfig;
  private _pool: KeyPool;

  constructor(
    private readonly configPath: string,
    initial: GatewayConfig,
  ) {
    this._config = initial;
    this._pool = new KeyPool();
  }

  get config(): GatewayConfig {
    return this._config;
  }

  get pool(): KeyPool {
    return this._pool;
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
  }
}
