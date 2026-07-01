import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { gw } from "@/lib/gw";
import { handleAdmin } from "@/gw/core/admin-handler.js";
import { isSessionValid, SESSION_COOKIE } from "@/lib/session";
import { SECURITY_HEADERS, adminResultToResponse, bodyTooLarge } from "@/lib/http";

type Ctx = { params: Promise<{ path: string[] }> };

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse | Response> {
  const sub = path.join("/");
  if (!sub.startsWith("admin/")) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const g = gw();
  // Defense in depth: proxy.ts (middleware) already gates every /api/* route on
  // the same version-bound session check — re-verified here explicitly rather
  // than trusting middleware ordering for the most sensitive path (this is the
  // browser dashboard's only channel into admin mutations).
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!isSessionValid(token, g.auth.version)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: SECURITY_HEADERS });
  }

  if (bodyTooLarge(req)) {
    return NextResponse.json({ error: "request body too large" }, { status: 413, headers: SECURITY_HEADERS });
  }

  const segments = sub.split("/").slice(1);
  const url = new URL(req.url);
  const search = url.searchParams;

  let body: unknown = undefined;
  if (req.method !== "GET" && req.method !== "DELETE") {
    body = await req.json().catch(() => undefined);
  }

  const result = await handleAdmin(req.method, segments, search, body, {
    state: g.state,
    db: g.db,
    auth: g.auth,
    notifier: g.notifier,
    log: g.log,
  });

  return adminResultToResponse(result);
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
