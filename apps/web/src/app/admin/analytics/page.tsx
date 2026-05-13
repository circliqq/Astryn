"use client";

import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { AdminGuard } from "../admin-guard";
import { AdminNav } from "../admin-nav";

interface AnalyticsOverview {
  mau: number; // monthly active users
  dau: number; // daily active users
  avgSessionDuration: number;
  signupRate: number;
  retentionDay7: number;
  retentionDay30: number;
  avgWalletsPerUser: number;
  avgTasksPerUser: number;
}

interface TimeSeriesPoint {
  date: string;
  users: number;
  signups: number;
  wallets: number;
  tasks: number;
}

interface TimeSeriesResponse {
  data: TimeSeriesPoint[];
  range: { from: string; to: string };
}

function Metric({ label, value, format = "number" }: { label: string; value: number | string; format?: "number" | "percent" | "duration" }) {
  let formatted = value;
  if (format === "percent" && typeof value === "number") {
    formatted = `${(value * 100).toFixed(1)}%`;
  } else if (format === "duration" && typeof value === "number") {
    const minutes = Math.floor(value / 60);
    const seconds = value % 60;
    formatted = `${minutes}m ${seconds}s`;
  } else if (format === "number" && typeof value === "number") {
    formatted = value.toLocaleString();
  }

  return (
    <Panel className="p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-graphite-500">{label}</p>
      <p className="mt-2 text-[24px] font-semibold tabular-nums leading-none text-graphite-100">{formatted}</p>
    </Panel>
  );
}

export default function AdminAnalyticsPage() {
  const { data: overview, isLoading: overviewLoading } = useQuery<AnalyticsOverview>({
    queryKey: ["admin-analytics-overview"],
    queryFn: () => apiFetch<AnalyticsOverview>("/admin/analytics/overview"),
  });

  const { data: timeseries, isLoading: timeseriesLoading } = useQuery<TimeSeriesResponse>({
    queryKey: ["admin-analytics-timeseries"],
    queryFn: () => apiFetch<TimeSeriesResponse>("/admin/analytics/timeseries?days=30"),
  });

  return (
    <AppShell title="Admin · Analytics">
      <AdminGuard>
        <AdminNav />

        {overviewLoading || !overview ? (
          <p className="text-[13px] text-graphite-400">Loading…</p>
        ) : (
          <div className="space-y-5">
            <section>
              <h2 className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500">User Metrics</h2>
              <div className="grid gap-3 md:grid-cols-4">
                <Metric label="MAU" value={overview.mau} />
                <Metric label="DAU" value={overview.dau} />
                <Metric label="Signup rate" value={overview.signupRate} format="percent" />
                <Metric label="Avg session" value={overview.avgSessionDuration} format="duration" />
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500">Retention</h2>
              <div className="grid gap-3 md:grid-cols-2">
                <Metric label="Day 7 retention" value={overview.retentionDay7} format="percent" />
                <Metric label="Day 30 retention" value={overview.retentionDay30} format="percent" />
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500">Usage</h2>
              <div className="grid gap-3 md:grid-cols-2">
                <Metric label="Avg wallets per user" value={overview.avgWalletsPerUser} format="number" />
                <Metric label="Avg tasks per user" value={overview.avgTasksPerUser} format="number" />
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500">30-Day Trend</h2>
              <Panel className="p-4">
                {timeseriesLoading || !timeseries || timeseries.data.length === 0 ? (
                  <p className="text-[12px] text-graphite-400">Loading time series data…</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                      <thead className="bg-graphite-800/40 text-left">
                        <tr className="text-[11px] uppercase tracking-[0.04em] text-graphite-500">
                          <th className="px-3 py-2 font-medium">Date</th>
                          <th className="px-3 py-2 font-medium">Active users</th>
                          <th className="px-3 py-2 font-medium">Signups</th>
                          <th className="px-3 py-2 font-medium">Wallets</th>
                          <th className="px-3 py-2 font-medium">Tasks</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-graphite-700/60">
                        {timeseries.data.map((p) => (
                          <tr key={p.date} className="hover:bg-graphite-800/40">
                            <td className="px-3 py-2 text-graphite-400">{new Date(p.date).toLocaleDateString()}</td>
                            <td className="px-3 py-2 tabular-nums text-graphite-300">{p.users.toLocaleString()}</td>
                            <td className="px-3 py-2 tabular-nums text-graphite-300">{p.signups}</td>
                            <td className="px-3 py-2 tabular-nums text-graphite-300">{p.wallets}</td>
                            <td className="px-3 py-2 tabular-nums text-graphite-300">{p.tasks}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </section>
          </div>
        )}
      </AdminGuard>
    </AppShell>
  );
}
