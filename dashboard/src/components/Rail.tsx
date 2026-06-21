"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "./Icon";

// IA mirrors 9router: Endpoint (connection info) up top, routing folded into
// Combos (no separate "Routing" item). Order is the rail order top-to-bottom.
const CHANNELS = [
  { href: "/", label: "Overview", icon: "dashboard" },
  { href: "/endpoint", label: "Endpoint & Key", icon: "api" },
  { href: "/providers", label: "Providers & Keys", icon: "vpn_key" },
  { href: "/combos", label: "Combos & Routing", icon: "dashboard_customize" },
  { href: "/tools", label: "CLI Tools", icon: "cable" },
  { href: "/usage", label: "Usage", icon: "bar_chart" },
  { href: "/logs", label: "Logs", icon: "receipt_long" },
  { href: "/config", label: "Config", icon: "tune" },
];

export function Rail() {
  const path = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <Link href="/" className="rail-brand" aria-label="aigetwey">
        a
      </Link>

      <nav className="flex flex-col items-center gap-3">
        {CHANNELS.map((c) => {
          const active = c.href === "/" ? path === "/" : path.startsWith(c.href);
          return (
            <Link
              key={c.href}
              href={c.href}
              data-label={c.label}
              className={`rail-icon${active ? " rail-icon-active" : ""}`}
              aria-label={c.label}
            >
              <Icon name={c.icon} size={20} fill={active} />
            </Link>
          );
        })}
      </nav>

      <button onClick={logout} data-label="Disconnect" className="rail-icon" aria-label="Disconnect">
        <Icon name="logout" size={19} />
      </button>
    </>
  );
}
