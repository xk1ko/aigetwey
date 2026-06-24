import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sealSession, SESSION_COOKIE } from "@/lib/session";
import { checkGatewayAuth } from "@/lib/gateway";

/**
 * Login: the gateway is the source of truth for the admin password (a hash
 * store, changeable at runtime). We verify the submitted password directly
 * against the gateway, then store it encrypted in the session cookie so later
 * proxied calls can present it as the Bearer.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password) {
    return NextResponse.json({ error: "password required" }, { status: 400 });
  }
  if (!(await checkGatewayAuth(password))) {
    return NextResponse.json({ error: "wrong password (or gateway unreachable)" }, { status: 401 });
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, sealSession(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12, // 12h
  });
  return NextResponse.json({ ok: true });
}
