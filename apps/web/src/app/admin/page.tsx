"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";

interface Overview {
  users: number;
  wallets: number;
  tasks: number;
  rpcEndpoints: number;
}

export default function AdminPage() {
  const { data: overview, isLoading } = useQuery<Overview>({
    queryKey: ["admin-overview"],
    queryFn: () => apiFetch<Overview>("/admin/overview"),
  });

  const metrics: [string, string][] = overview
    ? [
        ["Users", String(overview.users)],
        ["Wallets", String(overview.wallets)],
        ["Tasks", String(overview.tasks)],
        ["RPC Endpoints", String(overview.rpcEndpoints)],
      ]
    : [];

  return (
    <AppShell title="Admin Panel">
      <div className="grid gap-4 md:grid-cols-4">
        {isLoading ? (
          <p className="text-[13px] text-graphite-400 md:col-span-4">Loading…</p>
        ) : (
          metrics.map(([label, value]) => (
            <Panel key={label} className="p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-graphite-500">{label}</p>
              <p className="mt-2 text-[28px] font-semibold tabular-nums leading-none text-graphite-100">{value}</p>
            </Panel>
          ))
        )}
      </div>
    </AppShell>
  );
}
