import type { NextRequest } from "next/server";
import { gw } from "@/lib/gw";
import { handleAdmin } from "@/gw/core/admin-handler.js";
import { checkAdminAuth } from "@/gw/middleware/auth.js";
import { SECURITY_HEADERS, adminResultToResponse, bodyTooLarge } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, ctx: Ctx): Promise<Response> {
  const g = gw();
  const authRes = checkAdminAuth(req.headers, g.auth);
  if (!authRes.ok) {
    return Response.json({ error: authRes.error }, { status: authRes.status ?? 401, headers: SECURITY_HEADERS });
  }

  if (bodyTooLarge(req)) {
    return Response.json({ error: "request body too large" }, { status: 413, headers: SECURITY_HEADERS });
  }

  const segments = (await ctx.params).path;
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

export async function GET(req: NextRequest, ctx: Ctx) { return handle(req, ctx); }
export async function POST(req: NextRequest, ctx: Ctx) { return handle(req, ctx); }
export async function PUT(req: NextRequest, ctx: Ctx) { return handle(req, ctx); }
export async function DELETE(req: NextRequest, ctx: Ctx) { return handle(req, ctx); }
export async function PATCH(req: NextRequest, ctx: Ctx) { return handle(req, ctx); }
