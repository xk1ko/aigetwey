import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function getDataDir(): string {
  const env = process.env.AIGETWEY_DATA_DIR;
  return env ? resolve(env) : join(homedir(), ".aigetwey");
}

export function getConfigPath(): string {
  const env = process.env.AIGETWEY_CONFIG;
  return env ? resolve(env) : join(getDataDir(), "config.yaml");
}
