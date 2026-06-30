import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { gw } from "@/lib/gw";
import { handleAdmin } from "@/gw/core/admin-handler.js";
import { checkAdminAuth } from "@/gw/middleware/auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "0",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: NextRequest, ctx: Ctx): Promise<Response> {
  const g = gw();
  const authRes = checkAdminAuth(req.headers, g.auth);
  if (!authRes.ok) {
    return Response.json({ error: authRes.error }, { status: authRes.status ?? 401, headers: SECURITY_HEADERS });
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

  if (result.stream) {
    return new Response(result.stream, {
      status: result.status,
      headers: { ...SECURITY_HEADERS, ...(result.headers ?? {}) },
    });
  }

  if (typeof result.body === "string") {
    return new NextResponse(result.body, {
      status: result.status,
      headers: { ...SECURITY_HEADERS, ...(result.headers ?? {}) },
    });
  }

  return NextResponse.json(result.body ?? {}, {
    status: result.status,
    headers: { ...SECURITY_HEADERS, ...(result.headers ?? {}) },
  });
}

export async function GET(req: NextRequest, ctx: Ctx) { return handle(req, ctx); }
export async function POST(req: NextRequest, ctx: Ctx) { return handle(req, ctx); }
export async function PUT(req: NextRequest, ctx: Ctx) { return handle(req, ctx); }
export async function DELETE(req: NextRequest, ctx: Ctx) { return handle(req, ctx); }
export async function PATCH(req: NextRequest, ctx: Ctx) { return handle(req, ctx); }
