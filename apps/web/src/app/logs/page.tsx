"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { io } from "socket.io-client";
import { ScrollText } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { Button, Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";

interface TaskSummary {
  id: string;
  status: string;
  collection: { name: string } | null;
}

interface Transaction {
  id: string;
  status: string;
  txHash: string | null;
  gasFeeWei: string | null;
  walletId: string;
}

interface TaskDetail {
  id: string;
  status: string;
  collection: { name: string } | null;
  logs: Array<{ id: string; message: string; level: string; createdAt: string }>;
  transactions: Transaction[];
}

interface Wallet {
  id: string;
  address: string;
  name: string;
}

const TX_STATUS: Record<string, string> = {
  PENDING: "Pending", CONFIRMED: "Confirmed", FAILED: "Failed",
};

const STEPS = ["Scheduled", "Preflight", "Simulation", "Signing", "Broadcasting", "Pending", "Confirming", "Completed"];

export default function LogsPage() {
  const [selectedId, setSelectedId] = useState("");
  const [liveLogs, setLiveLogs] = useState<string[]>([]);

  const { data: tasks = [] } = useQuery<TaskSummary[]>({
    queryKey: ["mint-tasks"],
    queryFn: () => apiFetch<TaskSummary[]>("/mint-tasks"),
  });

  const { data: task } = useQuery<TaskDetail>({
    queryKey: ["mint-task-detail", selectedId],
    queryFn: () => apiFetch<TaskDetail>(`/mint-tasks/${selectedId}`),
    enabled: !!selectedId,
  });

  const { data: wallets = [] } = useQuery<Wallet[]>({
    queryKey: ["wallets"],
    queryFn: () => apiFetch<Wallet[]>("/wallets"),
  });

  useEffect(() => {
    if (!task) return;
    setLiveLogs(
      task.logs
        .slice()
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map((l) => `[${new Date(l.createdAt).toLocaleTimeString()}] ${l.message}`)
    );
  }, [task]);

  useEffect(() => {
    const API = "";
    const socket = io(`${API}/events`);
    socket.on("task.log.created", (payload: { message: string }) => {
      setLiveLogs((prev) => [...prev, payload.message]);
    });
    return () => { socket.disconnect(); };
  }, []);

  const walletMap = new Map(wallets.map((w) => [w.id, w]));

  const title = task?.collection?.name ? `Task — ${task.collection.name}` : "Task Logs";

  return (
    <AppShell title={title}>
      <div className="space-y-5">
        <Panel className="p-4">
          <select
            className="h-8 w-full rounded-md border border-graphite-700 bg-graphite-800 px-3 text-[13px] text-graphite-100 focus:border-brand focus:outline-none"
            value={selectedId}
            onChange={(e) => { setSelectedId(e.target.value); setLiveLogs([]); }}
          >
            <option value="">— Select a task —</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id.slice(0, 8)} — {t.collection?.name ?? "Unknown"} ({t.status})
              </option>
            ))}
          </select>
        </Panel>

        {selectedId ? (
          <div className="grid gap-5 xl:grid-cols-[220px_1fr]">
            <Panel className="p-4">
              <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-graphite-500">Execution Steps</p>
              {STEPS.map((step) => (
                <div key={step} className="flex items-start gap-2.5 pb-4 last:pb-0">
                  <span className="mt-[5px] size-[5px] shrink-0 rounded-full bg-graphite-600" />
                  <p className="text-[12px] text-graphite-400">{step}</p>
                </div>
              ))}
            </Panel>

            <div className="space-y-5">
              <Panel className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-[13px] font-semibold text-graphite-100">Live Logs</h2>
                  <Button variant="secondary" className="h-8" onClick={() => setLiveLogs([])}>
                    Clear
                  </Button>
                </div>
                <pre className="terminal min-h-[280px] overflow-auto rounded-md border border-graphite-700 p-4 text-xs leading-6">
                  {liveLogs.length > 0 ? liveLogs.join("\n") : "No logs yet."}
                </pre>
              </Panel>

              {task && task.transactions.length > 0 && (
                <Panel>
                  <div className="overflow-x-auto">
                    <table className="data-table w-full min-w-[700px] text-left">
                      <thead>
                        <tr>
                          {["Wallet", "Status", "Tx Hash", "Gas Used"].map((h) => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {task.transactions.map((tx) => {
                          const wallet = walletMap.get(tx.walletId);
                          return (
                            <tr key={tx.id}>
                              <td className="font-mono text-[11px] text-graphite-300" data-wallet-address>
                                {wallet?.address ?? tx.walletId.slice(0, 12)}
                              </td>
                              <td>
                                <StatusPill status={TX_STATUS[tx.status] ?? tx.status} />
                              </td>
                              <td className="font-mono text-[11px] text-graphite-400">
                                {tx.txHash ?? "—"}
                              </td>
                              <td className="tabular-nums">
                                {tx.gasFeeWei
                                  ? `${(Number(tx.gasFeeWei) / 1e18).toFixed(6)} ETH`
                                  : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              )}
            </div>
          </div>
        ) : (
          <Panel>
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <div className="grid size-[52px] place-items-center rounded-full bg-[#1E2028]">
                <ScrollText size={24} className="text-graphite-500" />
              </div>
              <p className="mt-3 text-[13px] font-medium text-graphite-200">No task selected</p>
              <p className="mt-1 text-[12px] text-graphite-500">Select a task above to view its execution logs.</p>
            </div>
          </Panel>
        )}
      </div>
    </AppShell>
  );
}
