import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sealSession, SESSION_COOKIE } from "@/lib/session";
import { gw } from "@/lib/gw";

export async function POST(req: Request): Promise<NextResponse> {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password) {
    return NextResponse.json({ error: "password required" }, { status: 400 });
  }
  if (!gw().auth.verify(password)) {
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, sealSession(password), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return NextResponse.json({ ok: true });
}
