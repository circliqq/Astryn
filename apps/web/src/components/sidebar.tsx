"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity, BarChart3, Bell, BellRing, Calculator, ChevronDown,
  ClipboardCheck, Coins, Crosshair, Flame, Home, Layers, ListTodo,
  PieChart, Puzzle, Radar, ScrollText, SendHorizonal, Settings, ShieldCheck,
  UserSearch, Vault, Wallet, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Nav structure ─────────────────────────────────────────────────────────

interface NavItem  { href: string; label: string; icon: React.ElementType }
interface NavGroup { title: string; items: NavItem[]; defaultOpen?: boolean }

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    defaultOpen: true,
    items: [
      { href: "/dashboard", label: "Dashboard",    icon: Home   },
      { href: "/wallets",   label: "Wallet Vault", icon: Wallet },
    ],
  },
  {
    title: "Minting",
    defaultOpen: true,
    items: [
      { href: "/scanner",           label: "Scanner",              icon: Radar          },
      { href: "/live-scanner",      label: "Live Scanner",         icon: Activity       },
      { href: "/mint-tasks",        label: "Mint Tasks",           icon: ListTodo       },
      { href: "/direct-mint",       label: "Direct Mint",          icon: Puzzle         },
      { href: "/bundle-mint",       label: "Bundle Mint",          icon: Layers         },
      { href: "/whitelist-checker", label: "Whitelist Checker",    icon: ClipboardCheck },
      { href: "/gas-calculator",    label: "Gas Calculator",       icon: Calculator     },
    ],
  },
  {
    title: "Finance",
    defaultOpen: true,
    items: [
      { href: "/funding",       label: "Funding",          icon: Coins         },
      { href: "/distributor",   label: "ETH Distributor",  icon: SendHorizonal },
      { href: "/consolidation", label: "Consolidation",    icon: Vault         },
    ],
  },
  {
    title: "Trading",
    defaultOpen: false,
    items: [
      { href: "/sniper",          label: "Sniper",          icon: Crosshair    },
      { href: "/trader-tracker", label: "Sweep Alerts",    icon: UserSearch   },
      { href: "/mint-alerts",    label: "Mint Alerts",     icon: BellRing     },
      { href: "/portfolio",      label: "Portfolio & PnL", icon: PieChart     },
    ],
  },
  {
    title: "Monitoring",
    defaultOpen: false,
    items: [
      { href: "/reports",    label: "Reports",    icon: BarChart3  },
      { href: "/rpc-health", label: "RPC Health", icon: Activity   },
      { href: "/logs",       label: "Live Logs",  icon: ScrollText },
    ],
  },
  {
    title: "System",
    defaultOpen: false,
    items: [
      { href: "/notifications", label: "Notifications", icon: Bell        },
      { href: "/settings",      label: "Settings",      icon: Settings    },
      { href: "/admin",         label: "Admin",         icon: ShieldCheck },
    ],
  },
];

// ── Logo ──────────────────────────────────────────────────────────────────

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="grid size-[28px] shrink-0 place-items-center rounded-[8px] leading-none text-white"
        style={{ background: "var(--brand)" }}
      >
        <Flame size={14} strokeWidth={2.2} />
      </span>
      <div className="flex flex-col leading-none">
        <span className="text-[13px] font-semibold tracking-tight" style={{ color: "var(--text-1)" }}>
          Astryn
        </span>
        <span
          className="text-[9px] font-medium uppercase tracking-widest"
          style={{ color: "var(--text-3)", letterSpacing: "0.14em" }}
        >
          Gas War
        </span>
      </div>
    </div>
  );
}

// ── Collapsible nav group ─────────────────────────────────────────────────

function NavGroupSection({
  group,
  pathname,
  isOpen,
  onToggle,
  onClose,
}: {
  group: NavGroup;
  pathname: string;
  isOpen: boolean;
  onToggle: () => void;
  onClose?: () => void;
}) {
  // If any item in this group is active, keep group open visually regardless
  const hasActive = group.items.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/")
  );
  const expanded = isOpen || hasActive;

  return (
    <div>
      {/* Group header */}
      <button
        type="button"
        className="nav-group-toggle"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="label" style={{ letterSpacing: "0.08em" }}>
          {group.title}
        </span>
        <ChevronDown
          size={11}
          style={{
            color: "var(--text-3)",
            transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 0.18s ease",
            flexShrink: 0,
          }}
        />
      </button>

      {/* Group items */}
      <div
        className="nav-group-items mt-0.5 space-y-[1px]"
        data-open={String(expanded)}
      >
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
  );
}

// ── Shared nav content ────────────────────────────────────────────────────

function NavContent({ pathname, onClose }: { pathname: string; onClose?: () => void }) {
  // Initialise open state from defaults (no localStorage to avoid SSR issues)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    NAV_GROUPS.forEach((g) => { initial[g.title] = g.defaultOpen ?? true; });
    return initial;
  });

  function toggleGroup(title: string) {
    setOpenGroups((prev) => ({ ...prev, [title]: !prev[title] }));
  }

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

      {/* Nav groups */}
      <nav className="flex-1 space-y-3 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <NavGroupSection
            key={group.title}
            group={group}
            pathname={pathname}
            isOpen={openGroups[group.title] ?? (group.defaultOpen ?? true)}
            onToggle={() => toggleGroup(group.title)}
            onClose={onClose}
          />
        ))}
      </nav>

      {/* Footer status */}
      <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--border)" }}>
        <div
          className="flex items-center gap-2.5 rounded-[7px] px-2.5 py-2"
          style={{ background: "var(--surface-2)" }}
        >
          <span
            className="grid size-[22px] shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
            style={{ background: "var(--brand)" }}
          >
            G
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium" style={{ color: "var(--text-1)" }}>
              GasWar Mode
            </p>
            <p className="text-[10px]" style={{ color: "var(--text-3)" }}>v1.0 · Active</p>
          </div>
          <span className="size-[6px] shrink-0 rounded-full" style={{ background: "#3DB860" }} />
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
      className="sticky top-0 hidden h-screen w-[210px] shrink-0 flex-col border-r px-3 py-4 lg:flex"
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
        className="fixed inset-y-0 left-0 z-50 flex w-[210px] flex-col overflow-y-auto border-r px-3 py-4 lg:hidden"
        style={{
          background: "var(--surface)",
          borderColor: "var(--border)",
          animation: "slideInLeft 0.16s ease forwards",
        }}
      >
        <NavContent pathname={pathname} onClose={onClose} />
      </aside>
      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(-100%); opacity: 0.6; }
          to   { transform: translateX(0);     opacity: 1; }
        }
      `}</style>
    </>
  );
}
