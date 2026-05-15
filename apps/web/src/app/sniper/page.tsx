"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crosshair, Pause, Play, Plus, Trash2, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel, Select } from "@/components/ui";
import { apiFetch } from "@/lib/api";

interface Wallet {
  id: string;
  name: string;
  address: string;
  network: "BASE" | "ETHEREUM";
  status: string;
}

interface SniperTask {
  id: string;
  walletId: string;
  type: "FAT_FINGER" | "RARITY";
  collectionSlug: string | null;
  contractAddress: string | null;
  network: "BASE" | "ETHEREUM";
  maxPriceWei: string;
  floorThreshold: number | null;
  minRarityScore: number | null;
  status: string;
  createdAt: string;
  wallet?: { name: string; address: string };
}

const STATUS_TONE: Record<string, "green" | "blue" | "yellow" | "red" | "slate"> = {
  WATCHING: "blue",
  TRIGGERED: "yellow",
  PAUSED: "slate",
  BOUGHT: "green",
  FAILED: "red",
};

function ethToWei(value: string) {
  const parsed = Number(value || "0");
  return String(Math.floor((Number.isFinite(parsed) ? parsed : 0) * 1e18));
}

function formatWei(value: string) {
  try {
    return `${(Number(BigInt(value)) / 1e18).toFixed(4)} ETH`;
  } catch {
    return "0.0000 ETH";
  }
}

export default function SniperPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    walletId: "",
    type: "FAT_FINGER" as "FAT_FINGER" | "RARITY",
    collectionSlug: "",
    contractAddress: "",
    network: "BASE" as "BASE" | "ETHEREUM",
    maxPriceEth: "0.05",
    floorThreshold: "0.7",
    minRarityScore: "80",
  });

  const { data: wallets = [] } = useQuery<Wallet[]>({
    queryKey: ["wallets"],
    queryFn: () => apiFetch<Wallet[]>("/wallets"),
  });

  const { data: tasks = [], isLoading } = useQuery<SniperTask[]>({
    queryKey: ["sniper-tasks"],
    queryFn: () => apiFetch<SniperTask[]>("/sniper"),
    refetchInterval: 20_000,
  });

  const walletOptions = useMemo(() => wallets.filter((wallet) => wallet.network === form.network), [wallets, form.network]);

  const createTask = useMutation({
    mutationFn: () =>
      apiFetch<SniperTask>("/sniper", {
        method: "POST",
        body: JSON.stringify({
          walletId: form.walletId,
          type: form.type,
          collectionSlug: form.collectionSlug.trim() || undefined,
          contractAddress: form.contractAddress.trim() || undefined,
          network: form.network,
          maxPriceWei: ethToWei(form.maxPriceEth),
          floorThreshold: form.type === "FAT_FINGER" ? Number(form.floorThreshold) : undefined,
          minRarityScore: form.type === "RARITY" ? Number(form.minRarityScore) : undefined,
        }),
      }),
    onSuccess: () => {
      setShowForm(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["sniper-tasks"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Unable to create sniper task."),
  });

  const taskAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" | "delete" }) => {
      if (action === "delete") return apiFetch(`/sniper/${id}`, { method: "DELETE" });
      return apiFetch(`/sniper/${id}/${action}`, { method: "PATCH" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sniper-tasks"] }),
  });

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.walletId) {
      setError("Select a wallet before creating a sniper task.");
      return;
    }
    createTask.mutate();
  }

  const activeTasks = tasks.filter((task) => ["WATCHING", "TRIGGERED"].includes(task.status)).length;
  const pausedTasks = tasks.filter((task) => task.status === "PAUSED").length;

  return (
    <AppShell title="Sniper">
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="metric-card">
            <p className="label-caps">Active watches</p>
            <p className="metric-value">{activeTasks}</p>
          </div>
          <div className="metric-card">
            <p className="label-caps">Paused</p>
            <p className="metric-value">{pausedTasks}</p>
          </div>
          <div className="metric-card">
            <p className="label-caps">Total strategies</p>
            <p className="metric-value">{tasks.length}</p>
          </div>
        </div>

        <Panel>
          <div className="panel-header">
            <div>
              <p className="text-[14px] font-semibold text-graphite-100">Trading Watches</p>
              <p className="mt-0.5 text-[12px] text-graphite-500">Clean strategy list for price and rarity triggers.</p>
            </div>
            <Button type="button" onClick={() => setShowForm(true)}>
              <Plus size={14} /> New Sniper
            </Button>
          </div>

          {isLoading ? (
            <div className="empty-state">Loading sniper tasks...</div>
          ) : tasks.length === 0 ? (
            <div className="empty-state">
              <div>
                <Crosshair size={28} className="mx-auto text-graphite-500" />
                <p className="mt-3 font-medium text-graphite-200">No sniper tasks yet</p>
                <p className="mt-1 text-[12px] text-graphite-500">Create a watch for underpriced or rare listings.</p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full min-w-[880px] text-left">
                <thead>
                  <tr>
                    <th>Collection</th>
                    <th>Wallet</th>
                    <th>Network</th>
                    <th>Trigger</th>
                    <th>Max Price</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => {
                    const canResume = task.status === "PAUSED";
                    const canPause = ["WATCHING", "TRIGGERED"].includes(task.status);
                    return (
                      <tr key={task.id}>
                        <td>
                          <p className="font-medium text-graphite-100">{task.collectionSlug || "Contract watch"}</p>
                          <p className="mt-0.5 font-mono text-[11px] text-graphite-500">{task.contractAddress ?? task.id.slice(0, 10)}</p>
                        </td>
                        <td>{task.wallet?.name ?? task.walletId.slice(0, 8)}</td>
                        <td>{task.network === "BASE" ? "Base" : "Ethereum"}</td>
                        <td>
                          {task.type === "FAT_FINGER"
                            ? `${Math.round((task.floorThreshold ?? 0.7) * 100)}% of floor`
                            : `Score ${task.minRarityScore ?? 0}+`}
                        </td>
                        <td className="font-mono text-[12px]">{formatWei(task.maxPriceWei)}</td>
                        <td><Badge tone={STATUS_TONE[task.status] ?? "slate"}>{task.status.replace(/_/g, " ")}</Badge></td>
                        <td>
                          <div className="flex items-center gap-1">
                            {canResume && (
                              <Button variant="ghost" size="sm" onClick={() => taskAction.mutate({ id: task.id, action: "resume" })}>
                                <Play size={13} />
                              </Button>
                            )}
                            {canPause && (
                              <Button variant="ghost" size="sm" onClick={() => taskAction.mutate({ id: task.id, action: "pause" })}>
                                <Pause size={13} />
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" onClick={() => taskAction.mutate({ id: task.id, action: "delete" })}>
                              <Trash2 size={13} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {showForm && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
            <Panel className="modal-surface w-full max-w-2xl p-0">
              <div className="panel-header">
                <div>
                  <p className="text-[14px] font-semibold text-graphite-100">New Sniper Task</p>
                  <p className="mt-0.5 text-[12px] text-graphite-500">Set a focused trigger with a clear spend ceiling.</p>
                </div>
                <button type="button" className="rounded p-1 text-graphite-500 hover:bg-graphite-800 hover:text-graphite-100" onClick={() => setShowForm(false)}>
                  <X size={16} />
                </button>
              </div>

              <form className="grid gap-4 p-5 md:grid-cols-2" onSubmit={handleSubmit}>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">Network</span>
                  <Select value={form.network} onChange={(event) => setField("network", event.target.value as "BASE" | "ETHEREUM")}>
                    <option value="BASE">Base</option>
                    <option value="ETHEREUM">Ethereum</option>
                  </Select>
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">Wallet</span>
                  <Select value={form.walletId} onChange={(event) => setField("walletId", event.target.value)}>
                    <option value="">Select wallet</option>
                    {walletOptions.map((wallet) => (
                      <option key={wallet.id} value={wallet.id}>{wallet.name}</option>
                    ))}
                  </Select>
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">Strategy</span>
                  <Select value={form.type} onChange={(event) => setField("type", event.target.value as "FAT_FINGER" | "RARITY")}>
                    <option value="FAT_FINGER">Fat finger</option>
                    <option value="RARITY">Rarity score</option>
                  </Select>
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">Max price ETH</span>
                  <Input type="number" min="0" step="any" value={form.maxPriceEth} onChange={(event) => setField("maxPriceEth", event.target.value)} />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">Collection slug</span>
                  <Input value={form.collectionSlug} onChange={(event) => setField("collectionSlug", event.target.value)} placeholder="collection-name" />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">Contract address</span>
                  <Input value={form.contractAddress} onChange={(event) => setField("contractAddress", event.target.value)} placeholder="0x..." />
                </label>
                {form.type === "FAT_FINGER" ? (
                  <label>
                    <span className="mb-1 block text-[11px] font-medium text-graphite-400">Floor threshold</span>
                    <Input type="number" min="0" max="1" step="any" value={form.floorThreshold} onChange={(event) => setField("floorThreshold", event.target.value)} />
                  </label>
                ) : (
                  <label>
                    <span className="mb-1 block text-[11px] font-medium text-graphite-400">Minimum rarity score</span>
                    <Input type="number" min="0" step="1" value={form.minRarityScore} onChange={(event) => setField("minRarityScore", event.target.value)} />
                  </label>
                )}
                {error && <p className="md:col-span-2 rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-[12px] text-status-red-text">{error}</p>}
                <div className="flex justify-end gap-2 md:col-span-2">
                  <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
                  <Button type="submit" disabled={createTask.isPending}>{createTask.isPending ? "Creating..." : "Create Task"}</Button>
                </div>
              </form>
            </Panel>
          </div>
        )}
      </div>
    </AppShell>
  );
}
