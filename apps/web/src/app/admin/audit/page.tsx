"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { Input, Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { AdminGuard } from "../admin-guard";
import { AdminNav } from "../admin-nav";

interface AuditEntry {
  id: string;
  action: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadataJson: unknown;
  createdAt: string;
  user: { id: string; email: string } | null;
}

interface AuditResponse {
  items: AuditEntry[];
  total: number;
  page: number;
  pages: number;
}

export default function AdminAuditPage() {
  const [userId, setUserId] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<AuditResponse>({
    queryKey: ["admin-audit", { userId, action, from, to, page }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (userId) params.set("userId", userId);
      if (action) params.set("action", action);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      params.set("page", String(page));
      return apiFetch<AuditResponse>(`/admin/audit-logs?${params.toString()}`);
    },
  });

  return (
    <AppShell title="Admin · Audit Log">
      <AdminGuard>
        <AdminNav />

        <div className="mb-3 grid gap-2 md:grid-cols-4">
          <Input placeholder="User ID" value={userId} onChange={(e) => { setUserId(e.target.value); setPage(1); }} />
          <Input placeholder="Action contains…" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
          <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </div>

        <Panel className="overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-graphite-800/40 text-left">
              <tr className="text-[11px] uppercase tracking-[0.04em] text-graphite-500">
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">IP</th>
                <th className="px-3 py-2 font-medium">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-graphite-700/60">
              {isLoading && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-graphite-500">Loading…</td></tr>
              )}
              {!isLoading && data?.items.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-graphite-500">No audit entries match.</td></tr>
              )}
              {data?.items.map((e) => (
                <tr key={e.id} className="hover:bg-graphite-800/40 align-top">
                  <td className="px-3 py-2 text-graphite-400">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-graphite-300">{e.user?.email ?? <span className="text-graphite-500">system</span>}</td>
                  <td className="px-3 py-2 font-mono text-graphite-100">{e.action}</td>
                  <td className="px-3 py-2 text-graphite-400">{e.ipAddress ?? "—"}</td>
                  <td className="px-3 py-2">
                    <pre className="max-w-md overflow-hidden text-ellipsis text-[11px] text-graphite-500">
                      {JSON.stringify(e.metadataJson)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        {data && data.pages > 1 && (
          <div className="mt-3 flex items-center justify-between text-[12px] text-graphite-400">
            <span>Page {data.page} of {data.pages} · {data.total.toLocaleString()} entries</span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded px-3 py-1 hover:bg-graphite-800 disabled:opacity-40">← Prev</button>
              <button disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)} className="rounded px-3 py-1 hover:bg-graphite-800 disabled:opacity-40">Next →</button>
            </div>
          </div>
        )}
      </AdminGuard>
    </AppShell>
  );
}
