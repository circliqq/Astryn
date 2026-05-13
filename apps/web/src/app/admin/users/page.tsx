"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Badge, Input, Panel, Select } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { AdminGuard } from "../admin-guard";
import { AdminNav } from "../admin-nav";

interface UserRow {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  bannedAt: string | null;
  lastSeenAt: string | null;
  riskScore: number;
  createdAt: string;
  _count: { wallets: number; mintTasks: number; supportTickets: number };
}

interface UsersResponse {
  items: UserRow[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export default function AdminUsersPage() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery<UsersResponse>({
    queryKey: ["admin-users", { q, role, status, page }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (role) params.set("role", role);
      if (status) params.set("status", status);
      params.set("page", String(page));
      return apiFetch<UsersResponse>(`/admin/users?${params.toString()}`);
    },
  });

  return (
    <AppShell title="Admin · Users">
      <AdminGuard>
        <AdminNav />

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search by email, name, or ID"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            className="max-w-xs"
          />
          <Select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
            <option value="">All roles</option>
            <option value="user">user</option>
            <option value="support">support</option>
            <option value="admin">admin</option>
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="banned">Banned</option>
          </Select>
        </div>

        <Panel className="overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-graphite-800/40 text-left">
              <tr className="text-[11px] uppercase tracking-[0.04em] text-graphite-500">
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Wallets</th>
                <th className="px-3 py-2 font-medium">Tasks</th>
                <th className="px-3 py-2 font-medium">Last seen</th>
                <th className="px-3 py-2 font-medium">Joined</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-graphite-700/60">
              {isLoading && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-graphite-500">Loading…</td></tr>
              )}
              {!isLoading && data?.items.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-graphite-500">No users found.</td></tr>
              )}
              {data?.items.map((u) => (
                <tr key={u.id} className="hover:bg-graphite-800/40">
                  <td className="px-3 py-2 text-graphite-100">
                    <div className="font-medium">{u.email}</div>
                    {u.displayName && <div className="text-[11px] text-graphite-500">{u.displayName}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={u.role === "admin" ? "blue" : u.role === "support" ? "yellow" : "slate"}>{u.role}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {u.bannedAt ? <Badge tone="red">banned</Badge> : <Badge tone="green">active</Badge>}
                    {u.riskScore >= 50 && <Badge tone="yellow" className="ml-1">risk {u.riskScore}</Badge>}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-graphite-300">{u._count.wallets}</td>
                  <td className="px-3 py-2 tabular-nums text-graphite-300">{u._count.mintTasks}</td>
                  <td className="px-3 py-2 text-graphite-400">
                    {u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-graphite-400">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/admin/users/${u.id}`} className="text-[12px] text-brand hover:underline">
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
              Page {data.page} of {data.pages} · {data.total.toLocaleString()} users
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
