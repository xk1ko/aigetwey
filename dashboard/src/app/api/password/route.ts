import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sealSession, SESSION_COOKIE } from "@/lib/session";
import { gateway } from "@/lib/gateway";

/**
 * Change the admin password. The gateway verifies the current password and
 * persists the new hash; on success we re-issue the session cookie carrying the
 * new password so this browser stays logged in (other sessions must re-login).
 */
export async function POST(req: Request): Promise<NextResponse> {
  const { current, next } = (await req.json().catch(() => ({}))) as { current?: string; next?: string };
  if (!current || !next) {
    return NextResponse.json({ error: "current and next are required" }, { status: 400 });
  }
  if (next.length < 4) {
    return NextResponse.json({ error: "new password must be at least 4 characters" }, { status: 400 });
  }

  const r = await gateway.changePassword(current, next);
  if (!r.ok) {
    return NextResponse.json({ error: r.error ?? "could not change password" }, { status: r.status || 400 });
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, sealSession(next), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return NextResponse.json({ ok: true });
}
