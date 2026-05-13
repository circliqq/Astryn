"use client";

import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { Badge, Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { AdminGuard } from "../admin-guard";
import { AdminNav } from "../admin-nav";

interface RpcEndpoint {
  id: string;
  url: string;
  network: string;
  enabled: boolean;
  lastCheckedAt: string | null;
  statusCode: number | null;
  latency: number | null;
  errorCount: number;
}

interface SystemHealth {
  database: {
    connected: boolean;
    responseTime: number;
  };
  cache: {
    connected: boolean;
    memoryUsed: number;
    memoryTotal: number;
  };
  rpc: RpcEndpoint[];
  uptime: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

export default function AdminSystemPage() {
  const { data, isLoading } = useQuery<SystemHealth>({
    queryKey: ["admin-system-health"],
    queryFn: () => apiFetch<SystemHealth>("/admin/system/health"),
  });

  return (
    <AppShell title="Admin · System">
      <AdminGuard>
        <AdminNav />

        {isLoading || !data ? (
          <p className="text-[13px] text-graphite-400">Loading…</p>
        ) : (
          <div className="space-y-5">
            <section>
              <h2 className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500">Core Services</h2>
              <div className="grid gap-3 md:grid-cols-2">
                <Panel className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-graphite-500">Database</p>
                      <p className="mt-2 text-[14px] font-semibold text-graphite-100">
                        {data.database.connected ? "Connected" : "Disconnected"}
                      </p>
                    </div>
                    <Badge tone={data.database.connected ? "green" : "red"}>
                      {data.database.connected ? "OK" : "ERROR"}
                    </Badge>
                  </div>
                  {data.database.connected && (
                    <p className="mt-3 text-[12px] text-graphite-400">
                      Response time: {data.database.responseTime}ms
                    </p>
                  )}
                </Panel>

                <Panel className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-graphite-500">Cache</p>
                      <p className="mt-2 text-[14px] font-semibold text-graphite-100">
                        {data.cache.connected ? "Connected" : "Disconnected"}
                      </p>
                    </div>
                    <Badge tone={data.cache.connected ? "green" : "red"}>
                      {data.cache.connected ? "OK" : "ERROR"}
                    </Badge>
                  </div>
                  {data.cache.connected && (
                    <p className="mt-3 text-[12px] text-graphite-400">
                      Memory: {formatBytes(data.cache.memoryUsed)} / {formatBytes(data.cache.memoryTotal)}
                    </p>
                  )}
                </Panel>
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500">Server</h2>
              <div className="grid gap-3 md:grid-cols-2">
                <Panel className="p-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-graphite-500">Uptime</p>
                  <p className="mt-2 text-[14px] font-semibold text-graphite-100">
                    {formatUptime(data.uptime)}
                  </p>
                </Panel>

                <Panel className="p-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-graphite-500">Memory usage</p>
                  <p className="mt-2 text-[14px] font-semibold text-graphite-100">
                    {formatBytes(data.memoryUsage.heapUsed)} / {formatBytes(data.memoryUsage.heapTotal)}
                  </p>
                  <div className="mt-2 h-2 rounded-full bg-graphite-800">
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{
                        width: `${Math.round((data.memoryUsage.heapUsed / data.memoryUsage.heapTotal) * 100)}%`,
                      }}
                    />
                  </div>
                </Panel>
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500">RPC Endpoints</h2>
              <Panel className="overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead className="bg-graphite-800/40 text-left">
                    <tr className="text-[11px] uppercase tracking-[0.04em] text-graphite-500">
                      <th className="px-3 py-2 font-medium">Network</th>
                      <th className="px-3 py-2 font-medium">URL</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Latency</th>
                      <th className="px-3 py-2 font-medium">Errors</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-graphite-700/60">
                    {data.rpc.map((rpc) => (
                      <tr key={rpc.id} className="hover:bg-graphite-800/40">
                        <td className="px-3 py-2 font-medium text-graphite-100">{rpc.network}</td>
                        <td className="px-3 py-2 truncate font-mono text-[11px] text-graphite-400">{rpc.url}</td>
                        <td className="px-3 py-2">
                          <Badge
                            tone={
                              !rpc.enabled
                                ? "slate"
                                : rpc.statusCode === 200
                                  ? "green"
                                  : "red"
                            }
                          >
                            {!rpc.enabled ? "disabled" : rpc.statusCode ? `${rpc.statusCode}` : "checking"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 tabular-nums text-graphite-300">
                          {rpc.latency ? `${rpc.latency}ms` : "—"}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-graphite-300">{rpc.errorCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </section>
          </div>
        )}
      </AdminGuard>
    </AppShell>
  );
}
