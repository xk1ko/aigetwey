import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { currentPassword } from "@/lib/session";

/**
 * Catch-all proxy to the gateway admin API. Client components call
 * `/api/gw/admin/...`; this forwards the method, body, and query to the gateway
 * with the admin password injected as a Bearer (never reaches the browser).
 *
 * Session-gated by middleware (every /api/* but login/logout needs a valid
 * session), so only a logged-in browser can drive it. One thin file replaces a
 * per-endpoint proxy for each admin route.
 */
function gatewayUrl(): string {
  return (process.env.GATEWAY_URL ?? "http://127.0.0.1:18080").replace(/\/$/, "");
}

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse | Response> {
  const sub = path.join("/");
  if (!sub.startsWith("admin/")) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const search = req.nextUrl.search;
  const target = `${gatewayUrl()}/${sub}${search}`;

  // SSE passthrough for console stream
  if (sub === "admin/console/stream") {
    try {
      const res = await fetch(target, {
        headers: { authorization: `Bearer ${await currentPassword()}` },
        cache: "no-store",
      });
      if (!res.body) return NextResponse.json({ error: "no stream" }, { status: 502 });
      return new Response(res.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          // don't let Next's prod server buffer the proxied stream.
          "X-Accel-Buffering": "no",
        },
      });
    } catch (e) {
      return NextResponse.json({ error: `gateway unreachable: ${(e as Error).message}` }, { status: 502 });
    }
  }

  const hasBody = req.method !== "GET" && req.method !== "DELETE";
  let body: string | undefined;
  if (hasBody) {
    body = await req.text();
  }

  let res: Response;
  try {
    res = await fetch(target, {
      method: req.method,
      headers: {
        authorization: `Bearer ${await currentPassword()}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body || undefined,
      cache: "no-store",
    });
  } catch (e) {
    return NextResponse.json({ error: `gateway unreachable: ${(e as Error).message}` }, { status: 502 });
  }

  const text = await res.text();
  return new NextResponse(text || "{}", {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

type Ctx = { params: Promise<{ path: string[] }> };

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
