"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel, Select } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { AdminGuard } from "../../admin-guard";
import { AdminNav } from "../../admin-nav";

interface UserDetail {
  user: {
    id: string;
    email: string;
    displayName: string | null;
    role: string;
    bannedAt: string | null;
    banReason: string | null;
    lastSeenAt: string | null;
    lastSeenIp: string | null;
    riskScore: number;
    createdAt: string;
    _count: { wallets: number; mintTasks: number; sniperTasks: number; sessions: number; supportTickets: number; fraudFlags: number };
  };
  sessions: { id: string; userAgent: string | null; ipAddress: string | null; createdAt: string; expiresAt: string }[];
  recentAudit: { id: string; action: string; ipAddress: string | null; createdAt: string; metadataJson: unknown }[];
  recentBans: { id: string; reason: string; createdAt: string; liftedAt: string | null }[];
  openFraud: { id: string; rule: string; severity: string; status: string; createdAt: string }[];
}

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const id = params.id;

  const [banReason, setBanReason] = useState("");
  const [newRole, setNewRole] = useState("");

  const { data, isLoading } = useQuery<UserDetail>({
    queryKey: ["admin-user", id],
    queryFn: () => apiFetch<UserDetail>(`/admin/users/${id}`),
    enabled: !!id,
  });

  const changeRole = useMutation({
    mutationFn: (role: string) => apiFetch(`/admin/users/${id}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-user", id] }),
  });
  const banUser = useMutation({
    mutationFn: (reason: string) => apiFetch(`/admin/users/${id}/ban`, { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => { setBanReason(""); qc.invalidateQueries({ queryKey: ["admin-user", id] }); },
  });
  const unbanUser = useMutation({
    mutationFn: () => apiFetch(`/admin/users/${id}/unban`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-user", id] }),
  });
  const forceLogout = useMutation({
    mutationFn: () => apiFetch(`/admin/users/${id}/force-logout`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-user", id] }),
  });
  const deleteUser = useMutation({
    mutationFn: () => apiFetch(`/admin/users/${id}`, { method: "DELETE" }),
    onSuccess: () => router.push("/admin/users"),
  });

  return (
    <AppShell title="Admin · User Detail">
      <AdminGuard>
        <AdminNav />
        {isLoading || !data ? (
          <p className="text-[13px] text-graphite-400">Loading…</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel className="p-5 lg:col-span-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold text-graphite-100">{data.user.email}</h2>
                  {data.user.displayName && <p className="text-[12px] text-graphite-400">{data.user.displayName}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge tone={data.user.role === "admin" ? "blue" : "slate"}>{data.user.role}</Badge>
                    {data.user.bannedAt ? <Badge tone="red">banned</Badge> : <Badge tone="green">active</Badge>}
                    {data.user.riskScore > 0 && <Badge tone="yellow">risk {data.user.riskScore}</Badge>}
                  </div>
                  {data.user.bannedAt && (
                    <p className="mt-2 text-[12px] text-status-red-text">
                      Banned {new Date(data.user.bannedAt).toLocaleString()} — {data.user.banReason ?? "no reason"}
                    </p>
                  )}
                </div>
                <div className="text-right text-[11px] text-graphite-500">
                  <p>Joined {new Date(data.user.createdAt).toLocaleDateString()}</p>
                  {data.user.lastSeenAt && <p>Last seen {new Date(data.user.lastSeenAt).toLocaleString()}</p>}
                  {data.user.lastSeenIp && <p>IP {data.user.lastSeenIp}</p>}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 md:grid-cols-6">
                <Stat label="Wallets" value={data.user._count.wallets} />
                <Stat label="Mints" value={data.user._count.mintTasks} />
                <Stat label="Snipers" value={data.user._count.sniperTasks} />
                <Stat label="Sessions" value={data.user._count.sessions} />
                <Stat label="Tickets" value={data.user._count.supportTickets} />
                <Stat label="Fraud" value={data.user._count.fraudFlags} tone={data.user._count.fraudFlags > 0 ? "warn" : "default"} />
              </div>
            </Panel>

            <Panel className="p-5">
              <h3 className="mb-3 text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500">Actions</h3>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Select value={newRole} onChange={(e) => setNewRole(e.target.value)} className="flex-1">
                    <option value="">Change role…</option>
                    <option value="user">user</option>
                    <option value="support">support</option>
                    <option value="admin">admin</option>
                  </Select>
                  <Button
                    variant="secondary"
                    onClick={() => newRole && changeRole.mutate(newRole)}
                    disabled={!newRole || changeRole.isPending}
                  >
                    Apply
                  </Button>
                </div>

                {data.user.bannedAt ? (
                  <Button variant="secondary" onClick={() => unbanUser.mutate()} disabled={unbanUser.isPending} className="w-full">
                    Unban user
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <Input
                      placeholder="Ban reason"
                      value={banReason}
                      onChange={(e) => setBanReason(e.target.value)}
                    />
                    <Button
                      variant="danger"
                      onClick={() => banReason && banUser.mutate(banReason)}
                      disabled={!banReason || banUser.isPending}
                      className="w-full"
                    >
                      Ban user
                    </Button>
                  </div>
                )}

                <Button variant="secondary" onClick={() => forceLogout.mutate()} disabled={forceLogout.isPending} className="w-full">
                  Force logout all sessions
                </Button>

                <Button
                  variant="danger"
                  onClick={() => {
                    if (confirm(`Permanently delete ${data.user.email}? This cannot be undone.`)) {
                      deleteUser.mutate();
                    }
                  }}
                  disabled={deleteUser.isPending}
                  className="w-full"
                >
                  Delete account
                </Button>
              </div>
            </Panel>

            <Panel className="p-5 lg:col-span-2">
              <h3 className="mb-3 text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500">Recent audit events</h3>
              {data.recentAudit.length === 0 ? (
                <p className="text-[12px] text-graphite-500">No events.</p>
              ) : (
                <ul className="space-y-1 text-[12px]">
                  {data.recentAudit.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 border-b border-graphite-800 py-1 last:border-0">
                      <span className="font-mono text-graphite-300">{a.action}</span>
                      <span className="text-[11px] text-graphite-500">
                        {a.ipAddress ?? "—"} · {new Date(a.createdAt).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel className="p-5">
              <h3 className="mb-3 text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500">Sessions</h3>
              {data.sessions.length === 0 ? (
                <p className="text-[12px] text-graphite-500">No active sessions.</p>
              ) : (
                <ul className="space-y-2 text-[12px]">
                  {data.sessions.map((s) => (
                    <li key={s.id} className="border-b border-graphite-800 pb-2 last:border-0 last:pb-0">
                      <p className="text-graphite-300">{s.ipAddress ?? "—"}</p>
                      <p className="text-[11px] text-graphite-500">
                        {s.userAgent?.slice(0, 60) ?? "Unknown UA"} · {new Date(s.createdAt).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            {data.openFraud.length > 0 && (
              <Panel className="p-5 lg:col-span-3">
                <h3 className="mb-3 text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500">Open fraud flags</h3>
                <ul className="space-y-1 text-[12px]">
                  {data.openFraud.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-3">
                      <span className="text-graphite-300">{f.rule}</span>
                      <Badge tone={f.severity === "CRITICAL" || f.severity === "HIGH" ? "red" : "yellow"}>{f.severity}</Badge>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        )}
      </AdminGuard>
    </AppShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "default" | "warn" }) {
  return (
    <div className="rounded-md border border-graphite-700 bg-graphite-900/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.04em] text-graphite-500">{label}</p>
      <p className={"text-[16px] font-semibold tabular-nums " + (tone === "warn" ? "text-status-yellow-text" : "text-graphite-100")}>
        {value}
      </p>
    </div>
  );
}
