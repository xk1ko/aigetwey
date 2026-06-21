import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminPassword, makeToken, SESSION_COOKIE } from "@/lib/session";
import { checkGatewayAuth } from "@/lib/gateway";

/**
 * Login: verify the submitted password against ADMIN_PASSWORD AND confirm the
 * gateway accepts it, then set the signed session cookie. The password is never
 * stored client-side — only the signed marker token.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };

  if (!password || password !== adminPassword()) {
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }
  // confirm the gateway is reachable and agrees on the password
  if (!(await checkGatewayAuth())) {
    return NextResponse.json({ error: "gateway rejected the password or is unreachable" }, { status: 502 });
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, makeToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12, // 12h
  });
  return NextResponse.json({ ok: true });
}
