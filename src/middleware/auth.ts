/**
 * Gateway-level auth. Clients present one of `server.api_keys` — OUR keys (handed
 * to your devices), distinct from the upstream provider keys in each provider.
 *
 * Accepted in either header so both client families work unchanged:
 *   - Authorization: Bearer <key>   (OpenAI-style clients)
 *   - x-api-key: <key>              (Anthropic-style clients)
 *
 * Empty `server.api_keys` allows loopback only — remote requests get 403.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

/** Non-secret stable id for a client key: sha256 truncated to 8 hex chars. */
export function clientKeyFingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

/** Constant-time: returns the matching key (digest every candidate) or null. */
export function matchKey(presented: string, validKeys: string[]): string | null {
  const p = digest(presented);
  let found: string | null = null;
  for (const k of validKeys) {
    if (timingSafeEqual(p, digest(k))) found = k;
  }
  return found;
}

export function isValidKey(presented: string, validKeys: string[]): boolean {
  return matchKey(presented, validKeys) !== null;
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
  keyFp?: string;
}

export function checkAuth(req: FastifyRequest, validKeys: string[]): AuthResult {
  if (validKeys.length === 0) {
    // No keys configured — allow loopback only, block external requests.
    const ip = req.ip;
    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
      return { ok: true };
    }
    return { ok: false, status: 403, error: "no api_keys configured — remote access blocked. Set server.api_keys in config." };
  }
  const key = extractKey(req);
  if (!key) return { ok: false, status: 401, error: "missing API key" };
  const matched = matchKey(key, validKeys);
  if (!matched) return { ok: false, status: 401, error: "invalid API key" };
  return { ok: true, keyFp: clientKeyFingerprint(matched) };
}

/** Verifies a presented admin password (against the persisted hash store). */
export interface AdminVerifier {
  enabled: boolean;
  verify(password: string): boolean;
}

/**
 * Admin auth for /admin/* — the password is presented as a Bearer token (the
 * dashboard proxies it server-side; never reaches the browser) and checked
 * against the hash store (seeded from AIGLOO_ADMIN_PASSWORD, changeable at
 * runtime).
 *
 * If no password is set, admin routes LOCK (503) rather than open — admin
 * surfaces provider keys, so failing open would leak secrets.
 */
export function checkAdminAuth(req: FastifyRequest, auth: AdminVerifier | undefined): AuthResult {
  if (!auth || !auth.enabled) {
    return { ok: false, status: 503, error: "admin disabled (set AIGLOO_ADMIN_PASSWORD)" };
  }
  const key = extractKey(req);
  if (!key) return { ok: false, status: 401, error: "missing admin password" };
  if (!auth.verify(key)) return { ok: false, status: 401, error: "invalid admin password" };
  return { ok: true };
}
