"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge, Input, Panel, Select } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { AdminGuard } from "../admin-guard";
import { AdminNav } from "../admin-nav";

interface TicketRow {
  id: string;
  subject: string;
  category: string | null;
  priority: string;
  status: string;
  user: { id: string; email: string };
  assignedTo: { id: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
}

interface TicketsResponse {
  items: TicketRow[];
  total: number;
  page: number;
  pages: number;
}

const PRIORITY_TONES: Record<string, "blue" | "yellow" | "red"> = {
  LOW: "blue",
  MEDIUM: "yellow",
  HIGH: "red",
  URGENT: "red",
};

const STATUS_TONES: Record<string, "blue" | "green" | "yellow" | "slate"> = {
  OPEN: "blue",
  IN_PROGRESS: "yellow",
  WAITING_USER: "yellow",
  RESOLVED: "green",
  CLOSED: "slate",
};

export default function AdminTicketsPage() {
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<TicketsResponse>({
    queryKey: ["admin-tickets", { search, priority, status, page }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (priority) params.set("priority", priority);
      if (status) params.set("status", status);
      params.set("page", String(page));
      return apiFetch<TicketsResponse>(`/admin/tickets?${params.toString()}`);
    },
  });

  return (
    <AppShell title="Admin · Support Tickets">
      <AdminGuard>
        <AdminNav />

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search by subject or user email"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="max-w-xs"
          />
          <Select value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }}>
            <option value="">All priorities</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="WAITING_USER">Waiting User</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
          </Select>
        </div>

        <Panel className="overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-graphite-800/40 text-left">
              <tr className="text-[11px] uppercase tracking-[0.04em] text-graphite-500">
                <th className="px-3 py-2 font-medium">Subject</th>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Priority</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Assigned</th>
                <th className="px-3 py-2 font-medium">Messages</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-graphite-700/60">
              {isLoading && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-graphite-500">Loading…</td></tr>
              )}
              {!isLoading && data?.items.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-graphite-500">No tickets found.</td></tr>
              )}
              {data?.items.map((t) => (
                <tr key={t.id} className="hover:bg-graphite-800/40">
                  <td className="px-3 py-2 text-graphite-100">
                    <div className="font-medium">{t.subject}</div>
                    {t.category && <div className="text-[11px] text-graphite-500">{t.category}</div>}
                  </td>
                  <td className="px-3 py-2 text-graphite-300">{t.user.email}</td>
                  <td className="px-3 py-2">
                    <Badge tone={PRIORITY_TONES[t.priority] || "blue"}>{t.priority}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={STATUS_TONES[t.status] || "slate"}>{t.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-graphite-400">
                    {t.assignedTo?.email ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums text-graphite-300">{t._count.messages}</td>
                  <td className="px-3 py-2 text-graphite-400">{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/admin/tickets/${t.id}`} className="text-[12px] text-brand hover:underline">
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        {data && data.pages > 1 && (
          <div className="mt-3 flex items-center justify-between text-[12px] text-graphite-400">
            <span>
              Page {data.page} of {data.pages} · {data.total.toLocaleString()} tickets
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
