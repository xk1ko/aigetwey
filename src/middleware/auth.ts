/**
 * Gateway-level auth. Clients present one of `server.api_keys` — OUR keys (handed
 * to your devices), distinct from the upstream provider keys in each provider.
 *
 * Accepted in either header so both client families work unchanged:
 *   - Authorization: Bearer <key>   (OpenAI-style clients)
 *   - x-api-key: <key>              (Anthropic-style clients)
 *
 * Empty `server.api_keys` disables auth (localhost dev mode).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/** Constant-time membership test over fixed-length digests. */
export function isValidKey(presented: string, validKeys: string[]): boolean {
  const p = digest(presented);
  // compare against every key so timing can't reveal which one matched.
  let ok = false;
  for (const k of validKeys) {
    if (timingSafeEqual(p, digest(k))) ok = true;
  }
  return ok;
}

export function extractKey(req: FastifyRequest): string | null {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  const xkey = req.headers["x-api-key"];
  if (typeof xkey === "string" && xkey.length > 0) return xkey;
  return null;
}

export interface AuthResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export function checkAuth(req: FastifyRequest, validKeys: string[]): AuthResult {
  if (validKeys.length === 0) return { ok: true }; // auth disabled
  const key = extractKey(req);
  if (!key) return { ok: false, status: 401, error: "missing API key" };
  if (!isValidKey(key, validKeys)) return { ok: false, status: 401, error: "invalid API key" };
  return { ok: true };
}

/**
 * Admin auth for /admin/* — a single password from AIGETWEY_ADMIN_PASSWORD as a
 * Bearer token (the dashboard proxies it server-side; never reaches the browser).
 *
 * If the env var is unset, admin routes LOCK (503) rather than open — admin
 * surfaces provider keys, so failing open would leak secrets.
 */
export function checkAdminAuth(req: FastifyRequest, password: string | undefined): AuthResult {
  if (!password) {
    return { ok: false, status: 503, error: "admin disabled (set AIGETWEY_ADMIN_PASSWORD)" };
  }
  const key = extractKey(req);
  if (!key) return { ok: false, status: 401, error: "missing admin password" };
  if (!isValidKey(key, [password])) return { ok: false, status: 401, error: "invalid admin password" };
  return { ok: true };
}
