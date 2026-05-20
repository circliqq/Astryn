"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, BarChart3, Bell, BellRing, Calculator, ClipboardCheck, Coins, Crosshair, Fuel, Home, Layers, ListTodo,
  PieChart, Puzzle, Radar, ScrollText, SendHorizonal, Settings, ShieldCheck, TrendingDown, Vault, Wallet, X,
  Flame,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Nav structure ─────────────────────────────────────────────────────────

interface NavItem  { href: string; label: string; icon: React.ElementType }
interface NavGroup { title: string; items: NavItem[] }

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Core",
    items: [
      { href: "/dashboard",  label: "Dashboard",   icon: Home   },
      { href: "/wallets",    label: "Wallet Vault", icon: Wallet },
    ],
  },
  {
    title: "Minting",
    items: [
      { href: "/scanner",            label: "Scanner",               icon: Radar          },
      { href: "/mint-tasks",         label: "Mint Tasks",            icon: ListTodo       },
      { href: "/direct-mint",        label: "Direct Contract Mint",  icon: Puzzle         },
      { href: "/whitelist-checker",  label: "Whitelist Check",       icon: ClipboardCheck },
      { href: "/gas-settings",       label: "Gas Settings",          icon: Fuel           },
      { href: "/gas-calculator",     label: "Gas Calculator",        icon: Calculator     },
    ],
  },
  {
    title: "Finance",
    items: [
      { href: "/funding",       label: "Funding Assistant",   icon: Coins         },
      { href: "/distributor",   label: "ETH Distributor",     icon: SendHorizonal },
      { href: "/consolidation", label: "Auto-Consolidation",  icon: Vault         },
    ],
  },
  {
    title: "Sniping & Trading",
    items: [
      { href: "/sniper",       label: "Sniper",          icon: Crosshair    },
      { href: "/sweep-alerts", label: "Sweep Alerts",    icon: TrendingDown },
      { href: "/mint-alerts",  label: "Mint Alerts",     icon: BellRing     },
      { href: "/portfolio",    label: "Portfolio & PnL", icon: PieChart     },
      { href: "/traits",       label: "Trait Explorer",  icon: Layers       },
    ],
  },
  {
    title: "Monitoring",
    items: [
      { href: "/reports",    label: "Reports",    icon: BarChart3  },
      { href: "/rpc-health", label: "RPC Health", icon: Activity   },
      { href: "/logs",       label: "Live Logs",  icon: ScrollText },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/notifications", label: "Notifications", icon: Bell       },
      { href: "/settings",      label: "Settings",      icon: Settings   },
      { href: "/admin",         label: "Admin Panel",   icon: ShieldCheck },
    ],
  },
];

// ── Logo ──────────────────────────────────────────────────────────────────

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="grid size-[28px] shrink-0 place-items-center rounded-[7px] leading-none text-white"
        style={{
          background: "linear-gradient(135deg, #FF6B35 0%, #E55A25 100%)",
          boxShadow: "0 2px 8px rgba(255,107,53,0.35)",
        }}
      >
        <Flame size={14} strokeWidth={2.2} />
      </span>
      <div className="flex flex-col leading-none">
        <span
          className="text-[13px] font-bold tracking-tight"
          style={{ color: "var(--text-1)" }}
        >
          Astryn
        </span>
        <span
          className="text-[9.5px] font-medium tracking-widest uppercase"
          style={{ color: "var(--text-3)", letterSpacing: "0.12em" }}
        >
          Gas War
        </span>
      </div>
    </div>
  );
}

// ── Shared nav content ────────────────────────────────────────────────────

function NavContent({ pathname, onClose }: { pathname: string; onClose?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex items-center justify-between px-1 pb-4">
        <Logo />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="nav-item p-1 lg:hidden"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-4 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <p
              className="label mb-1 px-2.5"
              style={{ letterSpacing: "0.09em" }}
            >
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
                    className={cn("nav-item min-h-[30px]", active && "nav-item-active")}
                  >
                    <Icon size={14} strokeWidth={active ? 2.2 : 1.7} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div
        className="mt-4 border-t pt-3"
        style={{ borderColor: "var(--border)" }}
      >
        <div
          className="flex items-center gap-2.5 rounded-[6px] px-2 py-2"
          style={{ background: "var(--surface-2)" }}
        >
          <span
            className="grid size-[22px] shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
            style={{ background: "linear-gradient(135deg, #FF6B35 0%, #E55A25 100%)" }}
          >
            G
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium" style={{ color: "var(--text-1)" }}>
              GasWar Mode
            </p>
            <p className="text-[10px]" style={{ color: "var(--text-3)" }}>v1.0 · Active</p>
          </div>
          <span
            className="size-[6px] shrink-0 rounded-full"
            style={{ background: "#34D058" }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Desktop sidebar ───────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside
      className="sticky top-0 hidden h-screen w-[220px] shrink-0 flex-col border-r px-3 py-4 lg:flex"
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
      }}
    >
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
      <div
        className="sidebar-backdrop fixed inset-0 z-40 lg:hidden"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="fixed inset-y-0 left-0 z-50 flex w-[220px] flex-col overflow-y-auto border-r px-3 py-4 lg:hidden"
        style={{
          background: "var(--surface)",
          borderColor: "var(--border)",
          animation: "slideInLeft 0.18s ease forwards",
        }}
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
