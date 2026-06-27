"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "./Icon";

// Floating icon-rail (user's preferred chrome), carrying aigetwey's IA: Endpoint
// is the landing, routing lives in Combos, and operational pages sit below a
// divider. Labels surface as hover tooltips (data-label).
type NavItem = { href: string; label: string; icon: string };

const MAIN: NavItem[] = [
  { href: "/", label: "Endpoint", icon: "api" },
  { href: "/keys", label: "Access Keys", icon: "key" },
  { href: "/providers", label: "Providers", icon: "dns" },
  { href: "/combos", label: "Combos", icon: "layers" },
  { href: "/usage", label: "Usage", icon: "bar_chart" },
  { href: "/quota", label: "Budgets", icon: "data_usage" },
  { href: "/tools", label: "CLI Tools", icon: "terminal" },
];

const SYSTEM: NavItem[] = [
  { href: "/console", label: "Server Console", icon: "receipt_long" },
  { href: "/config", label: "Settings", icon: "settings" },
];

export function Rail() {
  const path = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  // Endpoint owns both "/" (landing) and "/endpoint"; others match the segment
  // and its sub-routes (e.g. /providers/[id]).
  const isActive = (href: string) =>
    href === "/"
      ? path === "/" || path.startsWith("/endpoint")
      : path === href || path.startsWith(`${href}/`);

  const link = (item: NavItem) => {
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        data-label={item.label}
        className={`rail-icon${active ? " rail-icon-active" : ""}`}
        aria-label={item.label}
      >
        <Icon name={item.icon} size={20} fill={active} />
      </Link>
    );
  };

  return (
    <>
      <Link href="/" className="rail-brand" aria-label="aigetwey">
        {/* "a»" mark — ink on the lime tile (CSS provides the tile) */}
        <svg viewBox="0 0 512 512" width="26" height="26" aria-hidden>
          <text x="120" y="338" fontFamily="ui-sans-serif, Arial, sans-serif" fontSize="260" fontWeight="800" textAnchor="middle" fill="#14140f">a</text>
          <g fill="none" stroke="#14140f" strokeWidth="34" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="276,182 352,256 276,330" />
            <polyline points="346,182 422,256 346,330" />
          </g>
        </svg>
      </Link>

      <nav className="flex flex-col items-center gap-3">
        {MAIN.map(link)}
        <div className="rail-divider" />
        {SYSTEM.map(link)}
      </nav>

      <button onClick={logout} data-label="Disconnect" className="rail-icon" aria-label="Disconnect">
        <Icon name="logout" size={19} />
      </button>
    </>
  );
}
