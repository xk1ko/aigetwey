import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST(): Promise<NextResponse> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
