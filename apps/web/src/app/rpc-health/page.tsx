"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Pencil, Plus, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button, Input, Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";

interface RpcResult {
  endpointId: string;
  name: string;
  status: "healthy" | "degraded" | "offline";
  latencyMs: number | null;
  blockNumber: string | null;
  network: "BASE" | "ETHEREUM" | "ROBINHOOD";
  priority: number;
  checkedAt: string;
}

interface RpcEndpoint {
  id: string;
  name: string;
  url: string;
  network: "BASE" | "ETHEREUM" | "ROBINHOOD";
  priority: number;
  enabled: boolean;
}

function statusColor(status: string) {
  if (status === "healthy") return "text-status-green-text";
  if (status === "degraded") return "text-status-yellow-text";
  if (status === "unknown") return "text-graphite-400";
  return "text-status-red-text";
}

interface RpcEndpointPayload {
  name: string;
  url: string;
  network: "BASE" | "ETHEREUM" | "ROBINHOOD";
  priority: number;
}

function priorityLabel(priority: number) {
  if (priority === 1) return "Primary";
  if (priority > 1) return `Backup ${priority - 1}`;
  return `Priority ${priority}`;
}

export default function RpcHealthPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [network, setNetwork] = useState<"BASE" | "ETHEREUM" | "ROBINHOOD">("BASE");
  const [priority, setPriority] = useState("1");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: configuredEndpoints = [], isLoading: endpointsLoading } = useQuery<RpcEndpoint[]>({
    queryKey: ["rpc-endpoints"],
    queryFn: () => apiFetch<RpcEndpoint[]>("/rpc/endpoints"),
  });

  const { data: healthRows = [], isLoading: healthLoading, error } = useQuery<RpcResult[]>({
    queryKey: ["rpc-health"],
    queryFn: () => apiFetch<RpcResult[]>("/rpc/health"),
    refetchInterval: 30_000,
  });

  const createEndpoint = useMutation({
    mutationFn: (payload: RpcEndpointPayload) =>
      apiFetch(editingId ? `/rpc/endpoints/${editingId}` : "/rpc/endpoints", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      setName("");
      setUrl("");
      setNetwork("BASE");
      setPriority("1");
      setSubmitError(null);
      setShowForm(false);
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ["rpc-endpoints"] });
      await queryClient.invalidateQueries({ queryKey: ["rpc-health"] });
    },
    onError: (error: unknown) => {
      setSubmitError(error instanceof Error ? error.message : "Failed to save RPC endpoint.");
    }
  });

  const deleteEndpoint = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/rpc/endpoints/${id}`, {
        method: "DELETE",
      }),
    onSuccess: async (_, id) => {
      if (editingId === id) {
        resetForm();
        setShowForm(false);
      }
      await queryClient.invalidateQueries({ queryKey: ["rpc-endpoints"] });
      await queryClient.invalidateQueries({ queryKey: ["rpc-health"] });
    },
    onError: (error: unknown) => {
      setSubmitError(error instanceof Error ? error.message : "Failed to delete RPC endpoint.");
    }
  });

  const healthById = new Map(healthRows.map((row) => [row.endpointId, row]));
  const endpoints = configuredEndpoints.map((endpoint) => {
    const health = healthById.get(endpoint.id);
    return {
      endpointId: endpoint.id,
      name: endpoint.name,
      url: endpoint.url,
      network: endpoint.network,
      priority: endpoint.priority,
      enabled: endpoint.enabled,
      status: health?.status ?? "unknown",
      latencyMs: health?.latencyMs ?? null,
      blockNumber: health?.blockNumber ?? null,
      checkedAt: health?.checkedAt ?? null
    };
  });

  function resetForm() {
    setEditingId(null);
    setName("");
    setUrl("");
    setNetwork("BASE");
    setPriority("1");
    setSubmitError(null);
  }

  function openCreateForm() {
    resetForm();
    setShowForm(true);
  }

  function openEditForm(endpoint: RpcEndpoint) {
    setEditingId(endpoint.id);
    setName(endpoint.name);
    setUrl(endpoint.url);
    setNetwork(endpoint.network);
    setPriority(String(endpoint.priority));
    setSubmitError(null);
    setShowForm(true);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    createEndpoint.mutate({
      name: name.trim(),
      url: url.trim(),
      network,
      priority: Number(priority)
    });
  }

  function handleDelete(id: string) {
    setSubmitError(null);
    if (typeof window !== "undefined" && !window.confirm("Delete this RPC endpoint")) return;
    deleteEndpoint.mutate(id);
  }

  return (
    <AppShell title="RPC Health">
      <div className="space-y-5">
        <div className="flex justify-end">
          <Button type="button" onClick={showForm && !editingId ? () => setShowForm(false) : openCreateForm}>
            <Plus size={15} /> Add RPC Endpoint
          </Button>
        </div>

        {showForm && (
          <Panel className="p-5">
            <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
              <div className="md:col-span-2">
                <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.04em] text-graphite-500">Provider name</label>
                <Input
                  className="w-full"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alchemy Base Mainnet"
                  required
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.04em] text-graphite-500">RPC URL</label>
                <Input
                  className="w-full"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://..."
                  required
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.04em] text-graphite-500">Network</label>
                <select
                  className="h-8 w-full rounded-md border border-graphite-700 bg-graphite-800 px-3 text-[13px] text-graphite-100 focus:border-brand focus:outline-none"
                  value={network}
                  onChange={(e) => setNetwork(e.target.value as "BASE" | "ETHEREUM" | "ROBINHOOD")}
                >
                  <option value="BASE">Base</option>
                  <option value="ETHEREUM">Ethereum</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.04em] text-graphite-500">Priority</label>
                <Input
                  className="w-full"
                  type="number"
                  min="1"
                  step="1"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  required
                />
                <p className="mt-1.5 text-[11px] text-graphite-500">
                  1 = Primary · 2 = Backup 1 · 3 = Backup 2
                </p>
              </div>

              {submitError && (
                <p className="md:col-span-2 text-sm text-status-red-text">{submitError}</p>
              )}

              <div className="md:col-span-2 flex gap-3">
                <Button
                  type="submit"
                  disabled={
                    createEndpoint.isPending ||
                    !name.trim() ||
                    !url.trim() ||
                    !priority.trim() ||
                    Number.isNaN(Number(priority))
                  }
                >
                  {createEndpoint.isPending ? "Saving..." : editingId ? "Update Endpoint" : "Save Endpoint"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    resetForm();
                    setShowForm(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Panel>
        )}

        {endpointsLoading || healthLoading ? (
          <p className="text-[13px] text-graphite-400">Checking endpoints…</p>
        ) : error ? (
          <Panel className="p-6 text-[13px] text-status-red-text">
            {error instanceof Error ? error.message : "Failed to load RPC health."}
          </Panel>
        ) : endpoints.length === 0 ? (
          <Panel>
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <div className="grid size-[52px] place-items-center rounded-full" style={{ background: "var(--surface-2)" }}>
                <Activity size={24} style={{ color: "var(--text-3)" }} />
              </div>
              <p className="mt-3 text-[13px] font-medium" style={{ color: "var(--text-2)" }}>No RPC endpoints</p>
              <p className="mt-1 text-[12px]" style={{ color: "var(--text-3)" }}>Add an endpoint to start monitoring RPC health.</p>
            </div>
          </Panel>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {endpoints.map((rpc) => (
                <Panel key={rpc.endpointId} className="p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-graphite-500">{rpc.network === "BASE" ? "Base" : rpc.network === "ROBINHOOD" ? "Robinhood" : "Ethereum"} · {priorityLabel(rpc.priority)}</p>
                    <Activity className={statusColor(rpc.status)} size={14} />
                  </div>
                  <p className="mt-3 text-[15px] font-semibold text-graphite-100">{rpc.name}</p>
                  <div className="mt-3 flex items-center gap-3">
                    <span className={`text-[13px] font-medium capitalize ${statusColor(rpc.status)}`}>
                      {rpc.status}
                    </span>
                    <span className="text-[13px] tabular-nums text-graphite-400">
                      {rpc.latencyMs != null ? `${rpc.latencyMs}ms` : "—"}
                    </span>
                  </div>
                </Panel>
              ))}
            </div>

            <Panel>
              <div className="overflow-x-auto">
                <table className="data-table w-full min-w-[760px] text-left">
                  <thead>
                    <tr>
                      {["Provider", "Network", "Status", "Latency", "Last Block", "Priority", "Actions"].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {endpoints.map((rpc) => (
                      <tr key={rpc.endpointId}>
                        <td className="font-medium">{rpc.name}</td>
                        <td className="text-graphite-300">
                          {rpc.network === "BASE" ? "Base" : rpc.network === "ROBINHOOD" ? "Robinhood" : "Ethereum"}
                        </td>
                        <td className={`capitalize ${statusColor(rpc.status)}`}>
                          {rpc.status}
                        </td>
                        <td className="tabular-nums">
                          {rpc.latencyMs != null ? `${rpc.latencyMs}ms` : "—"}
                        </td>
                        <td className="font-mono text-[12px]">{rpc.blockNumber ?? "—"}</td>
                        <td>{priorityLabel(rpc.priority)}</td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                openEditForm({
                                  id: rpc.endpointId,
                                  name: rpc.name,
                                  url: rpc.url,
                                  network: rpc.network,
                                  priority: rpc.priority,
                                  enabled: true
                                })
                              }
                            >
                              <Pencil size={13} /> Edit
                            </Button>
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              disabled={deleteEndpoint.isPending}
                              onClick={() => handleDelete(rpc.endpointId)}
                            >
                              <Trash2 size={13} /> Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </>
        )}
      </div>
    </AppShell>
  );
}
