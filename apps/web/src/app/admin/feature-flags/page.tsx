"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { AdminGuard } from "../admin-guard";
import { AdminNav } from "../admin-nav";

interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string | null;
  rolloutPercentage: number;
  createdAt: string;
  updatedAt: string;
}

export default function AdminFeatureFlagsPage() {
  const [newKey, setNewKey] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const qc = useQueryClient();

  const { data: flags, isLoading } = useQuery<FeatureFlag[]>({
    queryKey: ["admin-feature-flags"],
    queryFn: () => apiFetch<FeatureFlag[]>("/admin/feature-flags"),
  });

  const createFlag = useMutation({
    mutationFn: () =>
      apiFetch("/admin/feature-flags", {
        method: "POST",
        body: JSON.stringify({
          key: newKey,
          description: newDescription || null,
          enabled: false,
          rolloutPercentage: 0,
        }),
      }),
    onSuccess: () => {
      setNewKey("");
      setNewDescription("");
      qc.invalidateQueries({ queryKey: ["admin-feature-flags"] });
    },
  });

  const deleteFlag = useMutation({
    mutationFn: (key: string) =>
      apiFetch(`/admin/feature-flags/${key}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-feature-flags"] }),
  });

  return (
    <AppShell title="Admin · Feature Flags">
      <AdminGuard>
        <AdminNav />

        <Panel className="mb-5 p-4">
          <h3 className="mb-3 text-[12px] font-medium uppercase tracking-[0.06em] text-graphite-500">Create new flag</h3>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-xs">
              <label className="text-[11px] text-graphite-500">Key</label>
              <Input
                placeholder="e.g., enable_new_dashboard"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value.toLowerCase())}
                className="mt-1"
              />
            </div>
            <div className="flex-1 min-w-xs">
              <label className="text-[11px] text-graphite-500">Description</label>
              <Input
                placeholder="What does this flag do?"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="mt-1"
              />
            </div>
            <Button
              onClick={() => createFlag.mutate()}
              disabled={!newKey || createFlag.isPending}
            >
              Create
            </Button>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-graphite-800/40 text-left">
              <tr className="text-[11px] uppercase tracking-[0.04em] text-graphite-500">
                <th className="px-3 py-2 font-medium">Key</th>
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Rollout</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-graphite-700/60">
              {isLoading && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-graphite-500">Loading…</td></tr>
              )}
              {!isLoading && !flags?.length && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-graphite-500">No feature flags.</td></tr>
              )}
              {flags?.map((f) => (
                <tr key={f.key} className="hover:bg-graphite-800/40">
                  <td className="px-3 py-2 font-mono text-graphite-100">{f.key}</td>
                  <td className="px-3 py-2 text-graphite-400">{f.description || "—"}</td>
                  <td className="px-3 py-2">
                    <Badge tone={f.enabled ? "green" : "slate"}>
                      {f.enabled ? "enabled" : "disabled"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-graphite-300">
                    {f.rolloutPercentage > 0 ? `${f.rolloutPercentage}%` : "—"}
                  </td>
                  <td className="px-3 py-2 text-graphite-400">
                    {new Date(f.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        if (confirm(`Delete flag "${f.key}"?`)) {
                          deleteFlag.mutate(f.key);
                        }
                      }}
                      disabled={deleteFlag.isPending}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </AdminGuard>
    </AppShell>
  );
}
