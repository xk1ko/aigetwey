import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isSessionValid, SESSION_COOKIE } from "@/lib/session";
import { AuthStore } from "@/gw/core/authStore.js";
import { getDataDir } from "@/gw/appDirs.js";

/**
 * Gate every page and admin-proxy route behind a valid session. The login page
 * and the auth endpoints stay open; everything else redirects to /login (pages)
 * or 401s (api). This is Next 16's `proxy` convention (formerly `middleware`).
 */
const OPEN = ["/login", "/api/login", "/api/logout", "/health", "/v1", "/admin"];

export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (OPEN.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // a session is valid only if its signature checks out AND its embedded
  // password-version still matches the current one — rotating the password
  // invalidates every outstanding session at once (also rejects stale
  // cookies from the older password-carrying cookie format, which had no `v`).
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (isSessionValid(token, AuthStore.currentVersion(getDataDir()))) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
}

export const config = {
  // run on everything except next internals and static assets. icon.svg is the
  // App Router favicon — it must stay public, else the auth gate redirects it to
  // /login and the browser tab shows no icon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
  // note: the proxy convention always runs on the Node.js runtime (no `runtime`
  // key allowed), which is what our node:crypto session check needs anyway.
};
