import { createHmac, timingSafeEqual, createCipheriv, createDecipheriv, scryptSync, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Dashboard session. The browser never holds the admin password in readable
 * form: on login we verify it against the gateway, encrypt it (AES-256-GCM) and
 * sign the ciphertext (HMAC), then store that in an httpOnly cookie. The proxy
 * and server-side fetches decrypt it to use as the gateway Bearer; the password
 * itself never reaches client JS.
 *
 * Cookie token = `<b64(iv|tag|ciphertext)>.<hmac(payload)>`. Middleware only
 * needs the HMAC check (cheap, edge-safe); decryption happens in node handlers.
 */
const _port = process.env.AIGLOO_PORT ?? process.env.PORT ?? "18080";
const COOKIE = `aigloo_session_${_port}`;

function secret(): string {
  return process.env.SESSION_SECRET ?? "";
}

function aesKey(): Buffer {
  return scryptSync(secret(), "aigloo-session-aes", 32);
}

export function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

/** Encrypt + sign the password into a cookie token. */
export function sealSession(password: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey(), iv);
  const ct = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, ct]).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Verify the token's signature only — no decryption (edge/middleware-safe). */
export function verifyToken(token: string | undefined): boolean {
  if (!token || !secret()) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Verify + decrypt the token back to the password, or null if tampered. */
export function openSession(token: string | undefined): string | null {
  if (!verifyToken(token) || !token) return null;
  try {
    const payload = Buffer.from(token.split(".")[0], "base64url");
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const ct = payload.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", aesKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** The logged-in admin password, read from the session cookie (server-side). */
export async function currentPassword(): Promise<string> {
  const token = (await cookies()).get(COOKIE)?.value;
  return openSession(token) ?? "";
}

export const SESSION_COOKIE = COOKIE;
