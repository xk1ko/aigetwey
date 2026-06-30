"use client";

import { useEffect, useState, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Client-side navigation loading indicator.
 *
 * Next.js loading.tsx only triggers on server-component suspense, but all
 * dashboard pages are client components. This component patches history.pushState
 * to detect navigation start, then hides when usePathname() confirms the new
 * route has mounted.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(false);
  const prevPath = useRef(pathname);
  const minTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Detect navigation START: patch history methods that Next.js calls internally
  useEffect(() => {
    const origPush = history.pushState;
    const origReplace = history.replaceState;

    const start = () => {
      setLoading(true);
      // Safety: never hang — hide after 5s no matter what
      if (minTimer.current) clearTimeout(minTimer.current);
      minTimer.current = setTimeout(() => setLoading(false), 5000);
    };

    history.pushState = function (this: History, ...args: Parameters<typeof history.pushState>) {
      start();
      return origPush.apply(this, args);
    };
    history.replaceState = function (this: History, ...args: Parameters<typeof history.replaceState>) {
      start();
      return origReplace.apply(this, args);
    };

    return () => {
      history.pushState = origPush;
      history.replaceState = origReplace;
      if (minTimer.current) clearTimeout(minTimer.current);
    };
  }, []);

  // Detect navigation COMPLETE: pathname changed
  useEffect(() => {
    if (prevPath.current !== pathname) {
      prevPath.current = pathname;
      // Brief delay so the new page's useEffect/data-fetch kicks off
      const t = setTimeout(() => setLoading(false), 120);
      return () => clearTimeout(t);
    }
  }, [pathname]);

  if (!loading) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-bg/40 backdrop-blur-[2px]">
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent [animation-delay:-0.3s]" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent [animation-delay:-0.15s]" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
      </div>
    </div>
  );
}
