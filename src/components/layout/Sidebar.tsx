"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/discover", label: "Discover" },
  { href: "/smart-money", label: "Smart Money" },
  { href: "/demo", label: "Demo" },
  { href: "/settings", label: "Settings" },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-border bg-surface">
      <div className="px-5 py-5 border-b border-border">
        <div className="text-sm font-semibold tracking-widest text-foreground">
          WALLETRADAR
        </div>
        <div className="text-xs text-muted mt-0.5">Smart Wallet Intelligence</div>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "block rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-surface-raised text-foreground font-medium"
                  : "text-muted hover:text-foreground hover:bg-surface-raised"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-4 border-t border-border text-[11px] text-muted leading-relaxed">
        Research platform. No real trading occurs. Data may be estimated —
        see reliability tags.
      </div>
    </aside>
  );
}
