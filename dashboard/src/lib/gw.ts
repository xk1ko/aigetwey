import "server-only";
import { join } from "node:path";
import { loadConfig } from "@/gw/config.js";
import { getDataDir, getConfigPath } from "@/gw/appDirs.js";
import { GatewayState } from "@/gw/core/state.js";
import { UsageDB } from "@/gw/db.js";
import { AuthStore } from "@/gw/core/authStore.js";
import { Notifier } from "@/gw/core/notifier.js";
import { RateLimiter } from "@/gw/core/ratelimit.js";
import { consoleBuffer } from "@/gw/core/console-buffer.js";
import { getPricingForModel, setRuntimePricingOverrides, type Pricing } from "@/gw/providers/pricing.js";

export interface Gw {
  state: GatewayState;
  db: UsageDB;
  auth: AuthStore;
  notifier: Notifier;
  limiter: RateLimiter;
  log: (msg: string) => void;
  close: () => void;
}

let _gw: Gw | null = null;

function init(): Gw {
  const configPath = getConfigPath();
  const config = loadConfig(configPath);
  const dataDir = getDataDir();
  const db = new UsageDB(join(dataDir, "usage.sqlite"));
  const state = new GatewayState(configPath, config, db);
  const auth = AuthStore.open(dataDir, process.env.AIGLOO_ADMIN_PASSWORD);
  const notifier = new Notifier(db);
  const limiter = new RateLimiter();

  const rows = db.listPricingOverrides();
  const map: Record<string, Pricing> = {};
  for (const r of rows) {
    const base = getPricingForModel(null, r.model);
    map[r.model] = {
      input: r.input ?? base?.input ?? 0,
      output: r.output ?? base?.output ?? 0,
      cached: r.cached ?? base?.cached,
      cache_creation: r.cache_creation ?? base?.cache_creation,
      reasoning: r.reasoning ?? base?.reasoning,
    };
  }
  setRuntimePricingOverrides(map);

  const log = (msg: string) => {
    consoleBuffer.push("INFO", msg);
    console.log(msg);
  };

  consoleBuffer.push("INFO", "aigloo gateway initialized");

  return { state, db, auth, notifier, limiter, log, close: () => db.close() };
}

export function gw(): Gw {
  if (!_gw) {
    try {
      _gw = init();
    } catch (e) {
      console.error("[gw] init FAILED:", e);
      throw e;
    }
  }
  return _gw;
}
