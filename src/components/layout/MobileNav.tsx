"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { NAV_ITEMS } from "./nav-items";

/**
 * Sidebar.tsx is `hidden md:flex` — below that breakpoint there was
 * previously no way to navigate at all (no hamburger, no fallback), so a
 * phone visiting any page other than the one it landed on was stuck. This
 * is the fix: a small header + toggleable nav drawer shown only on small
 * screens, sharing NAV_ITEMS with the desktop Sidebar so the two can't
 * drift apart.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="border-b border-border bg-surface md:hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="text-sm font-semibold tracking-widest text-foreground">WALLETRADAR</div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={open}
          className="rounded-md border border-border p-2 text-foreground"
        >
          <span className="relative block h-4 w-5">
            <span
              className={clsx(
                "absolute left-0 h-0.5 w-5 bg-current transition-all",
                open ? "top-[7px] rotate-45" : "top-0"
              )}
            />
            <span
              className={clsx(
                "absolute left-0 top-[7px] h-0.5 w-5 bg-current transition-opacity",
                open && "opacity-0"
              )}
            />
            <span
              className={clsx(
                "absolute left-0 h-0.5 w-5 bg-current transition-all",
                open ? "top-[7px] -rotate-45" : "top-[14px]"
              )}
            />
          </span>
        </button>
      </div>
      {open ? (
        <nav className="space-y-0.5 border-t border-border px-2 py-2">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={clsx(
                  "block rounded-md px-3 py-2 text-sm",
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
      ) : null}
    </div>
  );
}
