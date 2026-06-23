"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "./Icon";

// Floating icon-rail (user's preferred chrome), carrying 9router's IA: Endpoint
// is the landing, routing lives in Combos, and operational pages sit below a
// divider. Labels surface as hover tooltips (data-label).
type NavItem = { href: string; label: string; icon: string };

const MAIN: NavItem[] = [
  { href: "/", label: "Endpoint & Key", icon: "api" },
  { href: "/providers", label: "Providers", icon: "dns" },
  { href: "/combos", label: "Combos", icon: "layers" },
  { href: "/usage", label: "Usage", icon: "bar_chart" },
  { href: "/quota", label: "Quota Tracker", icon: "data_usage" },
  { href: "/tools", label: "CLI Tools", icon: "terminal" },
];

const SYSTEM: NavItem[] = [
  { href: "/logs", label: "Console Log", icon: "wysiwyg" },
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
        a
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
