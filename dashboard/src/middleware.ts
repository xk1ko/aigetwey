import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { openSession, SESSION_COOKIE } from "@/lib/session";

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

  // a session is valid only if its cookie decrypts to a password — this also
  // rejects stale cookies from an older format (which would yield an empty
  // Bearer and a confusing "missing admin password" from the gateway).
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (openSession(token)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  // run on everything except next internals and static assets. icon.svg is the
  // App Router favicon — it must stay public, else the auth gate redirects it to
  // /login and the browser tab shows no icon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
  // session verification uses node:crypto, unsupported on the Edge runtime
  runtime: "nodejs",
};
