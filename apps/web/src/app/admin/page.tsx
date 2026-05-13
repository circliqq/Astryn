"use client";

import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { AdminGuard } from "./admin-guard";
import { AdminNav } from "./admin-nav";

interface Overview {
  users: { total: number; new24h: number; banned: number; active7d: number };
  wallets: { total: number };
  tasks: { total: number; running: number };
  rpc: { total: number; disabled: number };
  support: { open: number };
  fraud: { open: number };
}

function Metric({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: "default" | "warn" | "danger" }) {
  return (
    <Panel className="p-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-graphite-500">{label}</p>
      <p
        className={
          "mt-2 text-[28px] font-semibold tabular-nums leading-none " +
          (tone === "danger" ? "text-status-red-text" : tone === "warn" ? "text-status-yellow-text" : "text-graphite-100")
        }
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-[11px] text-graphite-500">{sub}</p>}
    </Panel>
  );
}

export default function AdminOverviewPage() {
  const { data, isLoading } = useQuery<Overview>({
    queryKey: ["admin-overview"],
    queryFn: () => apiFetch<Overview>("/admin/overview"),
  });

  return (
    <AppShell title="Admin · Overview">
      <AdminGuard>
        <AdminNav />
        {isLoading || !data ? (
          <p className="text-[13px] text-graphite-400">Loading…</p>
        ) : (
          <div className="space-y-5">
            <section>
              <h2 className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500">Users</h2>
              <div className="grid gap-3 md:grid-cols-4">
                <Metric label="Total users" value={data.users.total} />
                <Metric label="New (24h)" value={data.users.new24h} />
                <Metric label="Active (7d)" value={data.users.active7d} />
                <Metric label="Banned" value={data.users.banned} tone={data.users.banned > 0 ? "warn" : "default"} />
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500">Operations</h2>
              <div className="grid gap-3 md:grid-cols-4">
                <Metric label="Wallets" value={data.wallets.total} />
                <Metric label="Mint tasks" value={data.tasks.total} sub={`${data.tasks.running} running`} />
                <Metric
                  label="RPC endpoints"
                  value={data.rpc.total}
                  sub={data.rpc.disabled > 0 ? `${data.rpc.disabled} disabled` : "all enabled"}
                  tone={data.rpc.disabled > 0 ? "warn" : "default"}
                />
                <Metric
                  label="Open fraud flags"
                  value={data.fraud.open}
                  tone={data.fraud.open > 0 ? "danger" : "default"}
                />
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500">Support</h2>
              <div className="grid gap-3 md:grid-cols-4">
                <Metric
                  label="Open tickets"
                  value={data.support.open}
                  tone={data.support.open > 5 ? "warn" : "default"}
                />
              </div>
            </section>
          </div>
        )}
      </AdminGuard>
    </AppShell>
  );
}
