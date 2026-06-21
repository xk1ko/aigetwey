/**
 * Mutable holder for the live gateway config.
 *
 * Config loads once at boot, but the dashboard edits it at runtime. Routes read
 * `state.config` fresh per request (never close over it), so a successful reload
 * swaps in the new config atomically — no restart.
 *
 * reload() validates and persists BEFORE swapping: an invalid edit throws and the
 * old config keeps serving. The keypool is added to this holder in Phase 4.
 */
import {
  GatewayConfig,
  parseConfigText,
  validateConfig,
  unmaskSecrets,
  writeConfigFile,
} from "../config.js";

export class GatewayState {
  private _config: GatewayConfig;

  constructor(
    private readonly configPath: string,
    initial: GatewayConfig,
  ) {
    this._config = initial;
  }

  get config(): GatewayConfig {
    return this._config;
  }

  /**
   * Validate edited config text, restore masked secrets from the live config,
   * persist atomically, then swap in. Throws without changing anything if
   * validation fails or a masked key can't be resolved — old config keeps serving.
   */
  reload(text: string): void {
    const parsed = parseConfigText(text);
    const merged = unmaskSecrets(parsed.raw, this._config.raw);
    const next = validateConfig(merged);
    writeConfigFile(this.configPath, next.raw);
    this._config = next;
  }
}
