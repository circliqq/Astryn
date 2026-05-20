"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { StatusPill } from "@/components/status-pill";
import { Button, Panel, Select } from "@/components/ui";
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

interface PnlData {
  investedEth: string;
  investedUsd: string;
  currentValueEth: string;
  currentValueUsd: string;
  pnlEth: string;
  pnlUsd: string;
  pnlPercent: number;
  floorPriceEth: string;
  mintPriceEth: string;
  gasEth: string;
  ethUsdPrice: number;
  mintQuantity: number;
  successfulMints: number;
  floorUnavailable: boolean;
}

function PnlCard({ taskId }: { taskId: string }) {
  const { data, isLoading, refetch, isRefetching } = useQuery<PnlData>({
    queryKey: ["pnl", taskId],
    queryFn: () => apiFetch<PnlData>(`/reports/${taskId}/pnl`),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Panel className="p-5">
        <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-3)" }}>
          <RefreshCw size={14} className="animate-spin" />
          Loading PnL…
        </div>
      </Panel>
    );
  }
  if (!data) return null;

  const pnl = data.pnlPercent;
  const isProfit = pnl > 0;
  const isLoss = pnl < 0;

  const sign = isProfit ? "+" : "";

  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2">
          {isProfit ? (
            <TrendingUp size={15} className="text-status-green-text" />
          ) : isLoss ? (
            <TrendingDown size={15} className="text-status-red-text" />
          ) : (
            <Minus size={15} style={{ color: "var(--text-3)" }} />
          )}
          <p className="text-[13px] font-semibold" style={{ color: "var(--text-1)" }}>PnL Summary</p>
          {data.floorUnavailable && (
            <span className="rounded bg-status-yellow-bg px-1.5 py-0.5 text-[10px] font-medium text-status-yellow-text">
              Floor unavailable
            </span>
          )}
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] disabled:opacity-50 transition-colors"
          style={{ color: "var(--text-3)" }}
        >
          <RefreshCw size={11} className={isRefetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="p-5" style={{ borderRight: "1px solid var(--border)" }}>
          <p className="text-[11px] font-medium uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}>Invested</p>
          <p className="mt-2 font-mono text-[22px] font-semibold tabular-nums leading-none" style={{ color: "var(--text-1)" }}>
            {data.investedEth} ETH
          </p>
          <p className="mt-1 font-mono text-[13px] tabular-nums" style={{ color: "var(--text-3)" }}>${data.investedUsd}</p>
        </div>

        <div className="p-5" style={{ borderRight: "1px solid var(--border)" }}>
          <p className="text-[11px] font-medium uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}>
            Current Value{data.floorUnavailable ? " (floor N/A)" : ""}
          </p>
          <p
            className="mt-2 font-mono text-[22px] font-semibold tabular-nums leading-none"
            style={{ color: data.floorUnavailable ? "var(--text-3)" : "var(--text-1)" }}
          >
            {data.floorUnavailable ? "—" : `${data.currentValueEth} ETH`}
          </p>
          <p className="mt-1 font-mono text-[13px] tabular-nums" style={{ color: "var(--text-3)" }}>
            {data.floorUnavailable ? "—" : `$${data.currentValueUsd}`}
          </p>
        </div>

        <div
          className={`p-5 ${isProfit ? "bg-status-green-bg" : isLoss ? "bg-status-red-bg" : ""}`}
          style={!isProfit && !isLoss ? { background: "var(--surface)" } : {}}
        >
          <p className="text-[11px] font-medium uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}>Profit / Loss</p>
          <p
            className={`mt-2 font-mono text-[22px] font-semibold tabular-nums leading-none ${isProfit ? "text-status-green-text" : isLoss ? "text-status-red-text" : ""}`}
            style={!isProfit && !isLoss ? { color: "var(--text-3)" } : {}}
          >
            {data.floorUnavailable ? "—" : `${sign}${data.pnlEth} ETH`}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`font-mono text-[13px] tabular-nums ${isProfit ? "text-status-green-text" : isLoss ? "text-status-red-text" : ""}`}
              style={!isProfit && !isLoss ? { color: "var(--text-3)" } : {}}
            >
              {data.floorUnavailable ? "—" : `${sign}$${data.pnlUsd}`}
            </span>
            {!data.floorUnavailable && (
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${isProfit ? "bg-status-green-bg text-status-green-text" : isLoss ? "bg-status-red-bg text-status-red-text" : ""}`}
                style={!isProfit && !isLoss ? { background: "var(--surface-2)", color: "var(--text-3)" } : {}}
              >
                {sign}{pnl.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1.5 px-5 py-3">
        <span className="text-[12px]" style={{ color: "var(--text-3)" }}>
          Mint price <span className="font-mono" style={{ color: "var(--text-2)" }}>{data.mintPriceEth} ETH</span>
        </span>
        <span className="text-[12px]" style={{ color: "var(--text-3)" }}>
          Gas <span className="font-mono" style={{ color: "var(--text-2)" }}>{data.gasEth} ETH</span>
        </span>
        <span className="text-[12px]" style={{ color: "var(--text-3)" }}>
          Floor <span className="font-mono" style={{ color: "var(--text-2)" }}>{data.floorUnavailable ? "N/A" : `${data.floorPriceEth} ETH`}</span>
        </span>
        <span className="text-[12px]" style={{ color: "var(--text-3)" }}>
          Wallets <span className="font-mono" style={{ color: "var(--text-2)" }}>{data.successfulMints} minted × {data.mintQuantity} qty</span>
        </span>
        {data.ethUsdPrice > 0 && (
          <span className="text-[12px]" style={{ color: "var(--text-3)" }}>
            ETH/USD <span className="font-mono" style={{ color: "var(--text-2)" }}>${data.ethUsdPrice.toLocaleString()}</span>
          </span>
        )}
      </div>
    </Panel>
  );
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
          <Select
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            <option value="">— Select a task —</option>
            {tasks.map((taskSummary) => (
              <option key={taskSummary.id} value={taskSummary.id}>
                {taskSummary.id.slice(0, 8)} — {taskSummary.collection?.name ?? "Unknown"} ({taskSummary.status})
              </option>
            ))}
          </Select>
        </Panel>

        {isLoading ? <p className="text-[13px]" style={{ color: "var(--text-3)" }}>Loading report…</p> : null}

        {task ? (
          <>
            <Panel className="flex items-center justify-between p-5">
              <div>
                <StatusPill status={task.status} />
                <h2 className="mt-2 text-[15px] font-semibold" style={{ color: "var(--text-1)" }}>
                  {task.collection?.name ?? "Unknown"} — {task.collection?.chain === "BASE" ? "Base" : "Ethereum"}
                </h2>
                <p className="mt-0.5 font-mono text-[11px]" style={{ color: "var(--text-3)" }}>Task {task.id.slice(0, 8)}</p>
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
                  <p className="text-[11px] font-medium uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}>{label}</p>
                  <p className="mt-2 text-[28px] font-semibold tabular-nums leading-none" style={{ color: "var(--text-1)" }}>{value}</p>
                  {sub ? <p className="mt-1.5 text-[12px]" style={{ color: "var(--text-3)" }}>{sub}</p> : null}
                </Panel>
              ))}
            </div>

            <PnlCard taskId={task.id} />

            {walletRows.length > 0 ? (
              <Panel>
                <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "1px solid var(--border)" }}>
                  <p className="text-[13px] font-semibold" style={{ color: "var(--text-1)" }}>Wallet Results</p>
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
                            <td className="font-mono text-[11px]" style={{ color: "var(--text-3)" }} data-wallet-address>
                              {wallet?.address ?? row.walletId.slice(0, 12)}
                            </td>
                            <td>
                              <StatusPill status={row.status} />
                            </td>
                            <td className="font-mono text-[11px]" style={{ color: "var(--text-3)" }}>{row.txHash ?? "—"}</td>
                            <td className="tabular-nums">{formatEth(row.gasFeeWei)}</td>
                            <td className="text-[12px]" style={{ color: "var(--text-3)" }}>{row.error ?? "—"}</td>
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
              <div className="grid size-[52px] place-items-center rounded-full" style={{ background: "var(--surface-2)" }}>
                <Download size={24} style={{ color: "var(--text-3)" }} />
              </div>
              <p className="mt-3 text-[13px] font-medium" style={{ color: "var(--text-2)" }}>No task selected</p>
              <p className="mt-1 text-[12px]" style={{ color: "var(--text-3)" }}>Select a completed task above to view its post-mint report.</p>
            </div>
          </Panel>
        ) : null}
      </div>
    </AppShell>
  );
}
