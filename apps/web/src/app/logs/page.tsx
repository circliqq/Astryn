"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { io } from "socket.io-client";
import { Activity, CheckCircle2, RadioTower, ScrollText, Zap } from "lucide-react";
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
  logs: LogEntry[];
  transactions: Transaction[];
}

interface LogEntry {
  id: string;
  message: string;
  level: string;
  createdAt: string;
  contextJson?: Record<string, unknown> | null;
}

interface Wallet {
  id: string;
  address: string;
  name: string;
}

const TX_STATUS: Record<string, string> = {
  PENDING: "Pending", CONFIRMED: "Confirmed", FAILED: "Failed",
};

const STEPS = [
  { label: "Scheduled", keys: ["Pre-arming", "Starting immediate", "Target broadcast"] },
  { label: "Preflight", keys: ["RPC health", "Pre-flight passed", "Selected"] },
  { label: "Simulation", keys: ["Simulation", "simulation"] },
  { label: "Signing", keys: ["signed and ready", "Preparing wallet"] },
  { label: "Broadcasting", keys: ["Broadcasting", "Broadcast accepted", "submitted"] },
  { label: "Pending", keys: ["PENDING", "receipt timeout", "pending"] },
  { label: "Confirming", keys: ["mint confirmed in block", "confirmed on-chain"] },
  { label: "Completed", keys: ["Mint task confirmed", "COMPLETED", "sold out"] },
];

function sortedLogs(task?: TaskDetail) {
  return (task?.logs ?? [])
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function ctxString(log: LogEntry, key: string) {
  const value = log.contextJson?.[key];
  return value == null ? null : String(value);
}

function classifyLog(message: string, level: string) {
  const lower = message.toLowerCase();
  if (lower.includes("first block hit") || lower.includes("mint confirmed in block")) return "success";
  if (lower.includes("live monitor") || lower.startsWith("block ")) return "monitor";
  if (lower.includes("sold out") || lower.includes("supply exhausted")) return "soldout";
  if (level === "error" || lower.includes("failed") || lower.includes("revert")) return "error";
  if (level === "warn" || lower.includes("fallback") || lower.includes("simulation still failing")) return "warn";
  if (lower.includes("broadcast") || lower.includes("submitted")) return "broadcast";
  return "info";
}

function logStyle(kind: string) {
  switch (kind) {
    case "success":
      return { borderColor: "rgba(34,197,94,.45)", background: "rgba(34,197,94,.08)", color: "#bbf7d0" };
    case "monitor":
      return { borderColor: "rgba(56,189,248,.45)", background: "rgba(56,189,248,.08)", color: "#bae6fd" };
    case "soldout":
      return { borderColor: "rgba(251,146,60,.5)", background: "rgba(251,146,60,.09)", color: "#fed7aa" };
    case "error":
      return { borderColor: "rgba(248,113,113,.55)", background: "rgba(248,113,113,.09)", color: "#fecaca" };
    case "warn":
      return { borderColor: "rgba(250,204,21,.45)", background: "rgba(250,204,21,.08)", color: "#fef08a" };
    case "broadcast":
      return { borderColor: "rgba(129,140,248,.45)", background: "rgba(129,140,248,.08)", color: "#c7d2fe" };
    default:
      return { borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-2)" };
  }
}

function monitorStats(logs: LogEntry[]) {
  const receipt = [...logs].reverse().find((log) => /mint confirmed in block \d+/i.test(log.message));
  const receiptMatch = receipt?.message.match(/mint confirmed in block (\d+).*?gas ([\d.]+) gwei.*?used ([\d,]+)/i);
  const blockLogs = logs.filter((log) => ctxString(log, "event") === "monitor.block");
  const soldOutLog = [...logs].reverse().find((log) =>
    ctxString(log, "event") === "monitor.soldOut" || /sold out|supply exhausted/i.test(log.message),
  );
  const startLog = logs.find((log) => ctxString(log, "event") === "monitor.start" || /watching from block/i.test(log.message));
  const startBlock = ctxString(startLog ?? ({} as LogEntry), "startBlock") ?? startLog?.message.match(/from block (\d+)/i)?.[1] ?? null;
  const receiptBlock = ctxString(receipt ?? ({} as LogEntry), "blockNumber") ?? receiptMatch?.[1] ?? null;
  const broadcastBlock = ctxString(receipt ?? ({} as LogEntry), "broadcastBlockNumber");
  const hitNumber = receipt?.message.includes("FIRST BLOCK HIT")
    ? "1st block"
    : receiptBlock && broadcastBlock
      ? `${Math.max(1, Number(receiptBlock) - Number(broadcastBlock))} block`
      : "Unknown";
  const latestBlock = blockLogs.at(-1);

  return {
    startBlock,
    receiptBlock,
    hitNumber,
    gasGwei: ctxString(receipt ?? ({} as LogEntry), "effectiveGasPriceGwei") ?? receiptMatch?.[2] ?? null,
    gasUsed: ctxString(receipt ?? ({} as LogEntry), "gasUsed") ?? receiptMatch?.[3] ?? null,
    totalSupply: ctxString(latestBlock ?? ({} as LogEntry), "totalSupply"),
    maxSupply: ctxString(latestBlock ?? ({} as LogEntry), "maxSupply"),
    soldOut: Boolean(soldOutLog),
    soldOutText: soldOutLog?.message ?? "Not detected yet",
    blocks: blockLogs,
  };
}

export default function LogsPage() {
  const [selectedId, setSelectedId] = useState("");
  const [, setLiveLogs] = useState<string[]>([]);

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
      sortedLogs(task)
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
  const logs = sortedLogs(task);
  const stats = monitorStats(logs);
  const stepState = STEPS.map((step) => {
    const matched = logs.find((log) => step.keys.some((key) => log.message.includes(key)));
    const hasWarn = matched && (matched.level === "warn" || /fallback|failing|sold out/i.test(matched.message));
    const hasError = matched && (matched.level === "error" || /failed|revert/i.test(matched.message));
    return { ...step, active: Boolean(matched), tone: hasError ? "error" : hasWarn ? "warn" : matched ? "done" : "idle" };
  });

  const title = task?.collection?.name ? `Task — ${task.collection.name}` : "Task Logs";

  return (
    <AppShell title={title}>
      <div className="space-y-5">
        <Panel className="p-4">
          <select
            className="h-8 w-full rounded-[7px] border px-3 text-[13px] focus:outline-none transition-colors"
            style={{ background: "var(--surface-2)", borderColor: "var(--border-2)", color: "var(--text-1)" }}
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
              <p className="label mb-3">Execution Steps</p>
              {stepState.map((step) => {
                const color = step.tone === "done" ? "#22c55e" : step.tone === "warn" ? "#f59e0b" : step.tone === "error" ? "#ef4444" : "var(--border-2)";
                return (
                <div key={step.label} className="flex items-start gap-2.5 pb-4 last:pb-0">
                  <span className="mt-[5px] size-[7px] shrink-0 rounded-full" style={{ background: color, boxShadow: step.active ? `0 0 14px ${color}` : "none" }} />
                  <p className="text-[12px] font-medium" style={{ color: step.active ? "var(--text-1)" : "var(--text-3)" }}>{step.label}</p>
                </div>
                );
              })}
            </Panel>

            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-4">
                <Panel className="p-4">
                  <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}><RadioTower size={14} /> Watch Block</div>
                  <p className="font-mono text-[18px] font-semibold" style={{ color: "var(--text-1)" }}>{stats.startBlock ?? "—"}</p>
                </Panel>
                <Panel className="p-4">
                  <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}><CheckCircle2 size={14} /> Our Hit</div>
                  <p className="font-mono text-[18px] font-semibold" style={{ color: stats.hitNumber === "1st block" ? "#86efac" : "var(--text-1)" }}>{stats.hitNumber}</p>
                  <p className="mt-1 text-[11px]" style={{ color: "var(--text-3)" }}>block {stats.receiptBlock ?? "—"}</p>
                </Panel>
                <Panel className="p-4">
                  <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}><Zap size={14} /> Gas</div>
                  <p className="font-mono text-[18px] font-semibold" style={{ color: "#bae6fd" }}>{stats.gasGwei ?? "—"} gwei</p>
                  <p className="mt-1 text-[11px]" style={{ color: "var(--text-3)" }}>used {stats.gasUsed ?? "—"}</p>
                </Panel>
                <Panel className="p-4">
                  <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.04em]" style={{ color: "var(--text-3)" }}><Activity size={14} /> Supply</div>
                  <p className="font-mono text-[18px] font-semibold" style={{ color: stats.soldOut ? "#fdba74" : "var(--text-1)" }}>{stats.totalSupply ?? "—"}{stats.maxSupply ? `/${stats.maxSupply}` : ""}</p>
                  <p className="mt-1 text-[11px]" style={{ color: stats.soldOut ? "#fdba74" : "var(--text-3)" }}>{stats.soldOut ? "Sold out detected" : "Monitoring"}</p>
                </Panel>
              </div>

              {stats.blocks.length > 0 && (
                <Panel className="p-4">
                  <h2 className="mb-3 text-[13px] font-semibold" style={{ color: "var(--text-1)" }}>Block Monitor</h2>
                  <div className="grid gap-2">
                    {stats.blocks.slice(-6).map((log) => (
                      <div key={log.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-[7px] border px-3 py-2 text-[12px]" style={logStyle("monitor")}>
                        <span className="font-mono">Block {ctxString(log, "blockNumber") ?? "—"}</span>
                        <span>{ctxString(log, "mintedThisBlock") ?? "?"} minted</span>
                        <span className="font-mono">{ctxString(log, "totalSupply") ?? "—"}{ctxString(log, "maxSupply") ? `/${ctxString(log, "maxSupply")}` : ""}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              <Panel className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-1)" }}>Live Logs</h2>
                  <Button variant="secondary" className="h-8" onClick={() => setLiveLogs([])}>
                    Clear
                  </Button>
                </div>
                <div className="min-h-[280px] space-y-2 overflow-auto rounded-[7px] border p-3 font-mono text-xs" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}>
                  {logs.length > 0 ? logs.map((log) => {
                    const kind = classifyLog(log.message, log.level);
                    return (
                      <div key={log.id} className="rounded-[7px] border px-3 py-2 leading-5" style={logStyle(kind)}>
                        <span style={{ color: "var(--text-3)" }}>[{new Date(log.createdAt).toLocaleTimeString()}]</span>{" "}
                        <span>{log.message}</span>
                      </div>
                    );
                  }) : <p style={{ color: "var(--text-3)" }}>No logs yet.</p>}
                </div>
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
                              <td className="font-mono text-[11px]" style={{ color: "var(--text-2)" }} data-wallet-address>
                                {wallet?.address ?? tx.walletId.slice(0, 12)}
                              </td>
                              <td>
                                <StatusPill status={TX_STATUS[tx.status] ?? tx.status} />
                              </td>
                              <td className="font-mono text-[11px]" style={{ color: "var(--text-3)" }}>
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
              <div className="grid size-[52px] place-items-center rounded-full" style={{ background: "var(--surface-2)" }}>
                <ScrollText size={24} style={{ color: "var(--text-3)" }} />
              </div>
              <p className="mt-3 text-[13px] font-medium" style={{ color: "var(--text-2)" }}>No task selected</p>
              <p className="mt-1 text-[12px]" style={{ color: "var(--text-3)" }}>Select a task above to view its execution logs.</p>
            </div>
          </Panel>
        )}
      </div>
    </AppShell>
  );
}
