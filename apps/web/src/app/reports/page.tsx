"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { Button, Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";

interface TaskSummary {
  id: string;
  status: string;
  collection: { name: string; chain: string } | null;
}

interface Transaction {
  id: string;
  status: string;
  txHash: string | null;
  gasFeeWei: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  walletId: string;
}

interface TaskWallet {
  id: string;
  walletId: string;
  status: string;
  errorCode: string | null;
}

interface PostMintReport {
  totalWallets: number;
  successfulMints: number;
  failedMints: number;
  totalGasSpentWei: string;
  avgConfirmationTimeSec: number | null;
  failureReasonsJson?: unknown;
}

interface TaskDetail {
  id: string;
  status: string;
  collection: { name: string; chain: string } | null;
  wallets: TaskWallet[];
  transactions: Transaction[];
  report: PostMintReport | null;
}

interface Wallet {
  id: string;
  address: string;
  name: string;
}

const TX_STATUS: Record<string, string> = {
  BROADCAST: "Pending",
  CONFIRMED: "Confirmed",
  FAILED: "Failed",
  PENDING: "Pending",
  SIGNED: "Pending",
  WAITING: "Waiting",
};

const WALLET_STATUS: Record<string, string> = {
  broadcasting: "Pending",
  failed: "Failed",
  pending: "Pending",
  ready: "Ready",
  success: "Success",
  waiting: "Waiting",
};

function formatEth(wei: string | null | undefined) {
  if (!wei || wei === "0") return "-";
  return `${(Number(BigInt(wei)) / 1e18).toFixed(6)} ETH`;
}

export default function ReportsPage() {
  const [selectedId, setSelectedId] = useState("");

  const { data: tasks = [] } = useQuery<TaskSummary[]>({
    queryKey: ["mint-tasks"],
    queryFn: () => apiFetch<TaskSummary[]>("/mint-tasks"),
  });

  const { data: task, isLoading } = useQuery<TaskDetail>({
    queryKey: ["mint-task-detail", selectedId],
    queryFn: () => apiFetch<TaskDetail>(`/mint-tasks/${selectedId}`),
    enabled: !!selectedId,
  });

  const { data: wallets = [] } = useQuery<Wallet[]>({
    queryKey: ["wallets"],
    queryFn: () => apiFetch<Wallet[]>("/wallets"),
  });

  const API = "";
  const walletMap = new Map(wallets.map((wallet) => [wallet.id, wallet]));
  const report = task?.report;
  const transactions = task?.transactions ?? [];
  const taskWallets = task?.wallets ?? [];
  const txByWalletId = new Map(transactions.map((tx) => [tx.walletId, tx]));
  const walletRows =
    taskWallets.length > 0
      ? taskWallets.map((taskWallet) => {
          const tx = txByWalletId.get(taskWallet.walletId);
          return {
            id: taskWallet.id,
            walletId: taskWallet.walletId,
            status: tx ? (TX_STATUS[tx.status] ?? tx.status) : (WALLET_STATUS[taskWallet.status] ?? taskWallet.status),
            txHash: tx?.txHash ?? null,
            gasFeeWei: tx?.gasFeeWei ?? null,
            error: tx?.errorMessage ?? tx?.errorCode ?? taskWallet.errorCode,
          };
        })
      : transactions.map((tx) => ({
          id: tx.id,
          walletId: tx.walletId,
          status: TX_STATUS[tx.status] ?? tx.status,
          txHash: tx.txHash,
          gasFeeWei: tx.gasFeeWei,
          error: tx.errorMessage ?? tx.errorCode,
        }));

  const fallbackSuccessCount = walletRows.filter((row) => row.status === "Confirmed" || row.status === "Success").length;
  const fallbackFailCount = walletRows.filter((row) => row.status === "Failed").length;
  const fallbackGasWei = transactions.reduce((sum, tx) => sum + BigInt(tx.gasFeeWei ?? "0"), 0n);
  const successCount = report?.successfulMints ?? fallbackSuccessCount;
  const failCount = report?.failedMints ?? fallbackFailCount;
  const totalWallets = report?.totalWallets ?? (taskWallets.length || transactions.length);
  const totalGasWei = report?.totalGasSpentWei ?? fallbackGasWei.toString();
  const totalGasEth = formatEth(totalGasWei).replace(" ETH", "");
  const avgSec =
    report?.avgConfirmationTimeSec != null && report.avgConfirmationTimeSec > 0
      ? report.avgConfirmationTimeSec.toFixed(1)
      : "-";

  return (
    <AppShell title="Post-Mint Report">
      <div className="space-y-5">
        <Panel className="p-4">
          <select
            className="h-8 w-full rounded-md border border-graphite-700 bg-graphite-800 px-3 text-[13px] text-graphite-100 focus:border-brand focus:outline-none"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            <option value="">— Select a task —</option>
            {tasks.map((taskSummary) => (
              <option key={taskSummary.id} value={taskSummary.id}>
                {taskSummary.id.slice(0, 8)} — {taskSummary.collection?.name ?? "Unknown"} ({taskSummary.status})
              </option>
            ))}
          </select>
        </Panel>

        {isLoading ? <p className="text-[13px] text-graphite-400">Loading report…</p> : null}

        {task ? (
          <>
            <Panel className="flex items-center justify-between p-5">
              <div>
                <StatusPill status={task.status} />
                <h2 className="mt-2 text-[15px] font-semibold text-graphite-100">
                  {task.collection?.name ?? "Unknown"} — {task.collection?.chain === "BASE" ? "Base" : "Ethereum"}
                </h2>
                <p className="mt-0.5 font-mono text-[11px] text-graphite-500">Task {task.id.slice(0, 8)}</p>
              </div>
              <a href={`${API}/api/reports/${task.id}/export-csv`} download>
                <Button variant="secondary">
                  <Download size={15} /> Export CSV
                </Button>
              </a>
            </Panel>

            <div className="grid gap-4 md:grid-cols-5">
              {[
                ["Total Wallets", String(totalWallets), ""],
                ["Successful", String(successCount), totalWallets > 0 ? `${Math.round((successCount / totalWallets) * 100)}%` : ""],
                ["Failed", String(failCount), totalWallets > 0 ? `${Math.round((failCount / totalWallets) * 100)}%` : ""],
                ["Total Gas Spent", `${totalGasEth} ETH`, ""],
                ["Avg Confirm Time", avgSec !== "-" ? `${avgSec} sec` : "-", ""],
              ].map(([label, value, sub]) => (
                <Panel key={label} className="p-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-graphite-500">{label}</p>
                  <p className="mt-2 text-[28px] font-semibold tabular-nums leading-none text-graphite-100">{value}</p>
                  {sub ? <p className="mt-1.5 text-[12px] text-graphite-500">{sub}</p> : null}
                </Panel>
              ))}
            </div>

            {walletRows.length > 0 ? (
              <Panel>
                <div className="flex items-center justify-between border-b border-graphite-700 px-5 py-3.5">
                  <p className="text-[13px] font-semibold text-graphite-100">Wallet Results</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="data-table w-full min-w-[760px] text-left">
                    <thead>
                      <tr>
                        {["Wallet", "Status", "Tx Hash", "Gas Fee", "Error"].map((heading) => (
                          <th key={heading}>{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {walletRows.map((row) => {
                        const wallet = walletMap.get(row.walletId);
                        return (
                          <tr key={row.id}>
                            <td className="font-mono text-[11px] text-graphite-400" data-wallet-address>
                              {wallet?.address ?? row.walletId.slice(0, 12)}
                            </td>
                            <td>
                              <StatusPill status={row.status} />
                            </td>
                            <td className="font-mono text-[11px] text-graphite-400">{row.txHash ?? "—"}</td>
                            <td className="tabular-nums">{formatEth(row.gasFeeWei)}</td>
                            <td className="text-[12px] text-graphite-400">{row.error ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            ) : null}
          </>
        ) : null}

        {!selectedId ? (
          <Panel>
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <div className="grid size-[52px] place-items-center rounded-full bg-[#1E2028]">
                <Download size={24} className="text-graphite-500" />
              </div>
              <p className="mt-3 text-[13px] font-medium text-graphite-200">No task selected</p>
              <p className="mt-1 text-[12px] text-graphite-500">Select a completed task above to view its post-mint report.</p>
            </div>
          </Panel>
        ) : null}
      </div>
    </AppShell>
  );
}
