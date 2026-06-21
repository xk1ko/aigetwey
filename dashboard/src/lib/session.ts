import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Dashboard session. The browser never holds the admin password — on login we
 * verify it server-side, then set an httpOnly cookie carrying a signed token
 * (HMAC of a fixed marker). The token proves "this browser logged in"; the
 * password itself stays on the server.
 */
const COOKIE = "aigetwey_session";
const MARKER = "ok"; // payload is fixed; the signature is what matters

function secret(): string {
  return process.env.SESSION_SECRET ?? "";
}

export function adminPassword(): string {
  return process.env.ADMIN_PASSWORD ?? "";
}

export function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

export function makeToken(): string {
  return `${MARKER}.${sign(MARKER)}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token || !secret()) return false;
  const [marker, sig] = token.split(".");
  if (marker !== MARKER || !sig) return false;
  const expected = sign(MARKER);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const SESSION_COOKIE = COOKIE;
