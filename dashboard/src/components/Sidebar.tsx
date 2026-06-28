"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "./Icon";

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
  { href: "/notifications", label: "Alerts", icon: "notifications" },
  { href: "/console", label: "Server Console", icon: "receipt_long" },
  { href: "/config", label: "Settings", icon: "settings" },
];

export function Sidebar() {
  const path = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

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
        className={`nav-isle${active ? " nav-isle-active" : ""}`}
        data-label={item.label}
      >
        <Icon name={item.icon} size={20} fill={active} />
      </Link>
    );
  };

  return (
    <aside className="app-sidebar">
      <Link href="/" className="brand-isle" data-label="aigloo">
        <svg viewBox="0 0 512 512" width="26" height="26" fill="none" aria-hidden>
          <g transform="translate(60, 60) scale(14)" stroke="currentColor" strokeLinecap="round">
            <path d="M4 20C4 12.268 8.477 6 14 6C19.523 6 24 12.268 24 20" strokeWidth="2"/>
            <path d="M8 20C8 14.477 10.686 10 14 10C17.314 10 20 14.477 20 20" strokeWidth="1.5" opacity="0.5"/>
            <line x1="3" y1="20" x2="25" y2="20" strokeWidth="2"/>
          </g>
        </svg>
      </Link>

      <div className="nav-isle-divider nav-isle-divider-brand" />

      <nav className="flex flex-col items-center gap-1.5">
        {MAIN.map(link)}
        <div className="nav-isle-divider" />
        {SYSTEM.map(link)}
      </nav>

      <button onClick={logout} className="nav-isle mt-2" data-label="Disconnect">
        <Icon name="logout" size={19} />
      </button>
    </aside>
  );
}
