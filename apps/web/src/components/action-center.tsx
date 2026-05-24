"use client";

import { useRouter } from "next/navigation";
import { Coins, Flame, PauseCircle, ShieldCheck } from "lucide-react";

interface ActionItem {
  label: string;
  sublabel: string;
  icon: React.ElementType;
  href: string;
  primary?: boolean;
}

const ACTIONS: ActionItem[] = [
  { label: "Start Mint",       sublabel: "Create a new mint task",  icon: Flame,       href: "/mint-setup", primary: true },
  { label: "Pause All",        sublabel: "Pause running tasks",     icon: PauseCircle, href: "/mint-tasks" },
  { label: "Fund Wallets",     sublabel: "Top up ETH balances",     icon: Coins,       href: "/funding"    },
  { label: "Check Readiness",  sublabel: "Scan wallet health",      icon: ShieldCheck, href: "/wallets"    },
];

export function ActionCenter() {
  const router = useRouter();

  return (
    <div
      className="rounded-[10px] border p-4"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <p className="label mb-3">Quick Actions</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ACTIONS.map(({ label, sublabel, icon: Icon, href, primary }) => (
          <button
            key={label}
            type="button"
            onClick={() => router.push(href)}
            className="flex min-h-[100px] flex-col items-start justify-between rounded-[8px] border p-3.5 text-left transition-colors"
            style={{
              background: primary ? "var(--brand-surface)" : "var(--surface-2)",
              borderColor: primary ? "var(--brand)" : "var(--border)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = primary
                ? "var(--brand)"
                : "var(--border-2)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = primary
                ? "var(--brand)"
                : "var(--border)";
            }}
          >
            <span
              className="grid size-7 place-items-center rounded-[6px]"
              style={{
                background: primary ? "var(--brand)" : "var(--surface-3)",
                color: primary ? "#fff" : "var(--text-2)",
              }}
            >
              <Icon size={14} strokeWidth={1.9} />
            </span>
            <div>
              <p
                className="text-[13px] font-medium leading-tight"
                style={{ color: "var(--text-1)" }}
              >
                {label}
              </p>
              <p
                className="mt-0.5 text-[11px] leading-tight"
                style={{ color: "var(--text-3)" }}
              >
                {sublabel}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
