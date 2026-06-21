import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken, SESSION_COOKIE } from "@/lib/session";

/**
 * Gate every page and admin-proxy route behind a valid session. The login page
 * and the auth endpoints stay open; everything else redirects to /login (pages)
 * or 401s (api).
 */
const OPEN = ["/login", "/api/login", "/api/logout"];

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (OPEN.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (verifyToken(token)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  // run on everything except next internals and static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
  // session verification uses node:crypto, unsupported on the Edge runtime
  runtime: "nodejs",
};
