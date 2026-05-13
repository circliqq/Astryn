"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS: { href: string; label: string }[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/tickets", label: "Support" },
  { href: "/admin/fraud", label: "Fraud" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/system", label: "System" },
  { href: "/admin/audit", label: "Audit Log" },
  { href: "/admin/feature-flags", label: "Feature Flags" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <div className="mb-5 -mx-1 overflow-x-auto">
      <nav className="flex min-w-max items-center gap-1 px-1">
        {TABS.map((tab) => {
          const active =
            tab.href === "/admin"
              ? pathname === "/admin"
              : pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
                active
                  ? "bg-graphite-800 text-graphite-100"
                  : "text-graphite-400 hover:bg-graphite-800/60 hover:text-graphite-100",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
