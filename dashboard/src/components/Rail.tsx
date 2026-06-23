"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "./Icon";

// IA mirrors 9router exactly (labels, icons, order): the landing page IS
// Endpoint & Key, routing lives inside Combos, and operational pages (logs,
// settings) sit under a "System" divider. Rendered in our warm-dark palette.
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
        className={`sidebar-link${active ? " sidebar-link-active" : ""}`}
      >
        <Icon name={item.icon} size={18} fill={active} />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <>
      {/* mac-style traffic lights — a familiar 9router cue */}
      <div className="flex items-center gap-2 px-5 pt-4 pb-1">
        <span className="h-3 w-3 rounded-full bg-[#ff5f56]" />
        <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
        <span className="h-3 w-3 rounded-full bg-[#27c93f]" />
      </div>

      <Link href="/" className="flex items-center gap-3 px-5 py-3" aria-label="aigetwey">
        <span className="sidebar-logo">
          <Icon name="hub" size={20} />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-[15px] font-semibold tracking-tight text-text">aigetwey</span>
          <span className="text-[11px] text-text-subtle">personal gateway</span>
        </span>
      </Link>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {MAIN.map(link)}
        <p className="sidebar-section">System</p>
        {SYSTEM.map(link)}
      </nav>

      <div className="border-t border-border-subtle px-3 py-3">
        <button onClick={logout} className="sidebar-link w-full" aria-label="Disconnect">
          <Icon name="logout" size={18} />
          <span>Disconnect</span>
        </button>
      </div>
    </>
  );
}
