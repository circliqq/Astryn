"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel, Select } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { AdminGuard } from "../admin-guard";
import { AdminNav } from "../admin-nav";

interface FraudFlag {
  id: string;
  rule: string;
  severity: string;
  status: string;
  user: { id: string; email: string };
  metadata: unknown;
  createdAt: string;
  resolvedAt: string | null;
  resolutionReason: string | null;
}

interface FraudResponse {
  items: FraudFlag[];
  total: number;
  page: number;
  pages: number;
}

const SEVERITY_TONES: Record<string, "red" | "yellow" | "blue"> = {
  CRITICAL: "red",
  HIGH: "red",
  MEDIUM: "yellow",
  LOW: "blue",
};

export default function AdminFraudPage() {
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("OPEN");
  const [page, setPage] = useState(1);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<FraudResponse>({
    queryKey: ["admin-fraud", { search, severity, status, page }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (severity) params.set("severity", severity);
      if (status) params.set("status", status);
      params.set("page", String(page));
      return apiFetch<FraudResponse>(`/admin/fraud?${params.toString()}`);
    },
  });

  const rescan = useMutation({
    mutationFn: () => apiFetch("/admin/fraud/rescan", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-fraud"] }),
  });

  const resolveFraud = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/admin/fraud/${id}/resolve`, {
        method: "PATCH",
        body: JSON.stringify({ reason: "Resolved by admin" }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-fraud"] }),
  });

  return (
    <AppShell title="Admin · Fraud Detection">
      <AdminGuard>
        <AdminNav />

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search by user email or rule"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="max-w-xs"
          />
          <Select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }}>
            <option value="">All severities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="OPEN">Open</option>
            <option value="RESOLVED">Resolved</option>
            <option value="ALL">All</option>
          </Select>
          <Button
            variant="secondary"
            onClick={() => rescan.mutate()}
            disabled={rescan.isPending}
            className="ml-auto"
          >
            {rescan.isPending ? "Rescanning…" : "Rescan all"}
          </Button>
        </div>

        <Panel className="overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-graphite-800/40 text-left">
              <tr className="text-[11px] uppercase tracking-[0.04em] text-graphite-500">
                <th className="px-3 py-2 font-medium">Rule</th>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Severity</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Detected</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-graphite-700/60">
              {isLoading && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-graphite-500">Loading…</td></tr>
              )}
              {!isLoading && data?.items.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-graphite-500">No fraud flags found.</td></tr>
              )}
              {data?.items.map((f) => (
                <tr key={f.id} className="hover:bg-graphite-800/40">
                  <td className="px-3 py-2 font-mono text-graphite-100">{f.rule}</td>
                  <td className="px-3 py-2 text-graphite-300">{f.user.email}</td>
                  <td className="px-3 py-2">
                    <Badge tone={SEVERITY_TONES[f.severity] || "blue"}>{f.severity}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={f.status === "OPEN" ? "red" : "slate"}>{f.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-graphite-400">{new Date(f.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">
                    {f.status === "OPEN" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => resolveFraud.mutate(f.id)}
                        disabled={resolveFraud.isPending}
                      >
                        Resolve
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        {data && data.pages > 1 && (
          <div className="mt-3 flex items-center justify-between text-[12px] text-graphite-400">
            <span>
              Page {data.page} of {data.pages} · {data.total.toLocaleString()} flags
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded px-3 py-1 hover:bg-graphite-800 disabled:opacity-40"
              >
                ← Prev
              </button>
              <button
                disabled={page >= data.pages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded px-3 py-1 hover:bg-graphite-800 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </AdminGuard>
    </AppShell>
  );
}
