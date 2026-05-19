"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, BarChart3, Bell, BellRing, Calculator, ClipboardCheck, Coins, Crosshair, Fuel, Home, Layers, ListTodo,
  PieChart, Puzzle, Radar, ScrollText, SendHorizonal, Settings, ShieldCheck, TrendingDown, Vault, Wallet, X,
} from "lucide-react";
import { Brand } from "./brand";
import { cn } from "@/lib/utils";

// ── Nav structure ─────────────────────────────────────────────────────────

interface NavItem  { href: string; label: string; icon: React.ElementType }
interface NavGroup { title: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Core",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: Home   },
      { href: "/wallets", label: "Wallet Vault", icon: Wallet },
    ],
  },
  {
    title: "Minting",
    items: [
      { href: "/scanner", label: "Scanner",      icon: Radar    },
      { href: "/mint-tasks", label: "Mint Tasks",   icon: ListTodo },
      { href: "/direct-mint", label: "Direct Contract Mint", icon: Puzzle },
      { href: "/whitelist-checker", label: "Whitelist Check", icon: ClipboardCheck },
      { href: "/gas-settings",    label: "Gas Settings",    icon: Fuel       },
      { href: "/gas-calculator", label: "Gas Calculator", icon: Calculator  },
    ],
  },
  {
    title: "Finance",
    items: [
      { href: "/funding", label: "Funding Assistant",    icon: Coins        },
      { href: "/distributor", label: "ETH Distributor",      icon: SendHorizonal},
      { href: "/consolidation", label: "Auto-Consolidation", icon: Vault        },
    ],
  },
  {
    title: "Sniping & Trading",
    items: [
      { href: "/sniper",        label: "Sniper",          icon: Crosshair    },
      { href: "/sweep-alerts",  label: "Sweep Alerts",    icon: TrendingDown },
      { href: "/mint-alerts",   label: "Mint Alerts",     icon: BellRing     },
      { href: "/portfolio",     label: "Portfolio & PnL", icon: PieChart     },
      { href: "/traits",        label: "Trait Explorer",  icon: Layers       },
    ],
  },
  {
    title: "Monitoring",
    items: [
      { href: "/reports", label: "Reports",    icon: BarChart3 },
      { href: "/rpc-health", label: "RPC Health", icon: Activity  },
      { href: "/logs", label: "Live Logs",  icon: ScrollText},
    ],
  },
  {
    title: "System",
    items: [
      { href: "/notifications", label: "Notifications", icon: Bell       },
      { href: "/settings", label: "Settings",      icon: Settings   },
      { href: "/admin", label: "Admin Panel",   icon: ShieldCheck},
    ],
  },
];

// ── Shared nav content ────────────────────────────────────────────────────

function NavContent({ pathname, onClose }: { pathname: string; onClose?: () => void }) {
  return (
    <>
      <div className="flex items-center justify-between px-1 pb-2">
        <Brand />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="rounded p-1 text-graphite-400 hover:bg-graphite-800 hover:text-graphite-100 lg:hidden"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <nav className="mt-4 space-y-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            {/* Section label */}
            <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-[0.06em] text-graphite-500">
              {group.title}
            </p>
            <div className="space-y-[1px]">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      "flex min-h-[32px] items-center gap-2.5 rounded-[5px] px-2.5 py-[6px]",
                      "text-[13px] leading-none transition-colors",
                      active
                        ? "nav-active"
                        : "text-graphite-400 hover:bg-graphite-800 hover:text-graphite-100"
                    )}
                  >
                    <Icon size={14} strokeWidth={active ? 2.2 : 1.8} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </>
  );
}

// ── Desktop sidebar ───────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-[240px] shrink-0 overflow-y-auto border-r border-graphite-700 bg-graphite-950 px-3 py-4 lg:block">
      <NavContent pathname={pathname} />
    </aside>
  );
}

// ── Mobile drawer ─────────────────────────────────────────────────────────

export function MobileSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  if (!open) return null;
  return (
    <>
      <div className="sidebar-backdrop fixed inset-0 z-40 lg:hidden" onClick={onClose} aria-hidden />
      <aside
        className="fixed inset-y-0 left-0 z-50 w-64 overflow-y-auto border-r border-graphite-700 bg-graphite-950 px-3 py-4 lg:hidden"
        style={{ animation: "slideInLeft 0.2s ease forwards" }}
      >
        <NavContent pathname={pathname} onClose={onClose} />
      </aside>
      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(-100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
