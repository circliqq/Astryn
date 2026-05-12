"use client";

import { useRouter } from "next/navigation";
import { Coins, Flame, PauseCircle, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface ActionItem {
  label: string;
  sublabel: string;
  icon: React.ElementType;
  href: string;
  primary?: boolean;   // only "Start Mint" gets the brand accent
}

const ACTIONS: ActionItem[] = [
  { label: "Start Mint", sublabel: "Create a new mint task",  icon: Flame,       href: "/mint-setup",  primary: true },
  { label: "Pause All", sublabel: "Pause running tasks",     icon: PauseCircle, href: "/mint-tasks" },
  { label: "Fund Wallets", sublabel: "Top up ETH balances",     icon: Coins,       href: "/funding"   },
  { label: "Check Readiness", sublabel: "Scan wallet health",      icon: ShieldCheck, href: "/wallets"   },
];

export function ActionCenter() {
  const router = useRouter();

  return (
    <div className="panel-section panel">
      <p className="label-caps mb-3">
        Quick Actions
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ACTIONS.map(({ label, sublabel, icon: Icon, href, primary }) => (
          <button
            key={label}
            type="button"
            onClick={() => router.push(href)}
            className={cn(
              "flex min-h-[112px] flex-col items-start justify-between rounded-md border p-3.5 text-left transition-colors",
              "border-graphite-700 bg-graphite-900",
              "hover:border-graphite-600 hover:bg-[#141720]",
            )}
          >
            <span
              className={cn(
                "grid size-7 place-items-center rounded-md",
                primary
                  ? "bg-brand/10 text-brand"
                  : "bg-graphite-800 text-graphite-400",
              )}
            >
              <Icon size={15} strokeWidth={1.8} />
            </span>
            <div>
              <p className={cn(
                "text-[13px] font-medium leading-tight",
                primary ? "text-graphite-100" : "text-graphite-200"
              )}>
                {label}
              </p>
              <p className="mt-0.5 text-[11px] leading-tight text-graphite-500">
                {sublabel}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
