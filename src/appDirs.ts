import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, renameSync } from "node:fs";

/** One-time migration: rename ~/.aigetwey → ~/.aigloo if the old dir exists. */
function migrateDataDir(): void {
  const oldDir = join(homedir(), ".aigetwey");
  const newDir = join(homedir(), ".aigloo");
  if (existsSync(oldDir) && !existsSync(newDir)) {
    try {
      renameSync(oldDir, newDir);
    } catch {
      // non-fatal — user can move it manually
    }
  }
}

export function getDataDir(): string {
  const env = process.env.AIGLOO_DATA_DIR;
  if (env) return resolve(env);
  migrateDataDir();
  return join(homedir(), ".aigloo");
}

export function getConfigPath(): string {
  const env = process.env.AIGLOO_CONFIG;
  return env ? resolve(env) : join(getDataDir(), "config.yaml");
}
