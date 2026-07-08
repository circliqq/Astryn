"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { RadioTower, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { ActionCenter } from "@/components/action-center";
import { GasChart } from "@/components/gas-chart";
import { ReadinessRing } from "@/components/readiness-ring";
import { TaskTimeline, type TimelineTask } from "@/components/task-timeline";
import { Badge, Button, Panel } from "@/components/ui";
import { StatusPill } from "@/components/status-pill";
import { apiFetch } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────
interface Wallet    { id: string; name: string; address: string; status: string; lastBalanceWei: string | null }
interface RpcResult { endpointId: string; name: string; status: string; latencyMs: number | null }
interface GasResult { baseFeePerGas: string; maxFeePerGas: string; maxPriorityFeePerGas: string }

const STATUS_REASON: Record<string, string> = {
  LOW_BALANCE:  "Low Balance",
  NEED_FUNDING: "Need Funding",
  NOT_ELIGIBLE: "Not Eligible",
  NONCE_ISSUE:  "Nonce Issue",
};

// ── Readiness modal ───────────────────────────────────────────────────────
function ReadinessModal({ wallets, onClose }: { wallets: Wallet[]; onClose: () => void }) {
  const notReady = wallets.filter((w) => w.status !== "READY");
  const router   = useRouter();

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center px-4"
      style={{ background: "rgba(0,0,0,0.65)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-surface w-full max-w-md p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2
              className="text-[14px] font-semibold tracking-tight"
              style={{ color: "var(--text-1)" }}
            >
              Wallet Inspection
            </h2>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-3)" }}>
              {notReady.length === 0
                ? "All wallets are ready"
                : `${notReady.length} wallet${notReady.length > 1 ? "s" : ""} need attention`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="nav-item p-1"
            style={{ color: "var(--text-3)" }}
          >
            <X size={15} />
          </button>
        </div>

        <div className="mt-4 max-h-72 space-y-1.5 overflow-y-auto">
          {notReady.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-status-green-text">
              All wallets are funded and ready.
            </p>
          ) : (
            notReady.map((w) => {
              const bal =
                w.lastBalanceWei && w.lastBalanceWei !== "0"
                  ? `${(Number(w.lastBalanceWei) / 1e18).toFixed(4)} ETH`
                  : "0 ETH";
              return (
                <div
                  key={w.id}
                  className="flex items-center justify-between rounded-[6px] border px-3 py-2.5"
                  style={{
                    background: "var(--surface-2)",
                    borderColor: "var(--border)",
                  }}
                >
                  <div className="min-w-0">
                    <p
                      className="truncate text-[13px] font-medium"
                      style={{ color: "var(--text-1)" }}
                    >
                      {w.name}
                    </p>
                    <p
                      className="truncate font-mono text-[11px]"
                      style={{ color: "var(--text-3)" }}
                      data-wallet-address
                    >
                      {w.address}
                    </p>
                  </div>
                  <div className="ml-3 flex shrink-0 flex-col items-end gap-1">
                    <StatusPill status={STATUS_REASON[w.status] ?? w.status} />
                    <span
                      className="text-[11px]"
                      style={{ color: "var(--text-3)" }}
                      data-wallet-balance
                    >
                      {bal}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {notReady.length > 0 && (
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Dismiss</Button>
            <Button onClick={() => { onClose(); router.push("/funding"); }}>Fund Wallets</Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router  = useRouter();
  const [network,   setNetwork]   = useState<"base" | "ethereum" | "robinhood">("base");
  const [showModal, setShowModal] = useState(false);

  const { data: wallets = [] } = useQuery<Wallet[]>({
    queryKey: ["wallets"],
    queryFn: () => apiFetch<Wallet[]>("/wallets"),
  });
  const { data: tasks = [] } = useQuery<TimelineTask[]>({
    queryKey: ["mint-tasks"],
    queryFn: () => apiFetch<TimelineTask[]>("/mint-tasks"),
  });
  const { data: rpc = [], error: rpcError } = useQuery<RpcResult[]>({
    queryKey: ["rpc-health"],
    queryFn: () => apiFetch<RpcResult[]>("/rpc/health"),
    refetchInterval: 60_000,
  });
  const { data: gas } = useQuery<GasResult>({
    queryKey: ["gas-current", network],
    queryFn: () => apiFetch<GasResult>(`/gas/current?network=${network}`),
    refetchInterval: 15_000,
  });

  const total   = wallets.length;
  const ready   = wallets.filter((w) => w.status === "READY").length;
  const sched   = tasks.filter((t) => t.status === "SCHEDULED").length;
  const success = tasks.filter((t) => ["COMPLETED", "CONFIRMED"].includes(t.status)).length;
  const failed  = tasks.filter((t) => t.status === "FAILED").length;

  const baseFee  = gas ? Number(BigInt(gas.baseFeePerGas)) / 1e9 : null;
  const priority = gas ? Number(BigInt(gas.maxPriorityFeePerGas)) / 1e9 : null;
  const maxFee   = gas ? Number(BigInt(gas.maxFeePerGas)) / 1e9 : null;
  const gasLevel = baseFee === null ? null : baseFee < 10 ? "Low" : baseFee < 50 ? "Medium" : "High";
  const score    = total > 0 ? Math.round((ready / total) * 100) : 0;

  const metrics = [
    { label: "Total Wallets",    value: total,   sub: `${ready} ready`,       warn: false },
    { label: "Ready Wallets",    value: ready,   sub: total > 0 ? `${score}% of total` : "—", warn: false },
    { label: "Scheduled Mints", value: sched,   sub: "pending",               warn: false },
    { label: "Successful Mints", value: success, sub: "all time",             warn: false },
    { label: "Failed Mints",     value: failed,  sub: failed > 0 ? "needs retry" : "all time", warn: failed > 0 },
  ];

  return (
    <AppShell title="Dashboard">
      <div className="space-y-4">

        {/* Action Center */}
        <ActionCenter />

        {/* Metric cards — 2 cols mobile, 3 medium, 5 wide */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {metrics.map((m) => (
            <div key={m.label} className="metric-card">
              <p className="label">{m.label}</p>
              <p className="metric-value">{m.value}</p>
              <p
                className="mt-1.5 text-[12px]"
                style={{ color: m.warn ? "var(--status-red, #F47067)" : "var(--text-3)" }}
              >
                {m.sub}
              </p>
            </div>
          ))}
        </div>

        {/* Middle row — readiness / gas / rpc */}
        <div className="grid gap-4 xl:grid-cols-12">

          {/* Wallet readiness ring */}
          <Panel className="flex flex-col items-center p-5 xl:col-span-4">
            <div className="mb-3 w-full">
              <p className="label">Wallet Readiness</p>
            </div>
            <ReadinessRing score={score} onClick={() => setShowModal(true)} />
            <p className="mt-3 text-[12px]" style={{ color: "var(--text-3)" }}>
              {ready} of {total} wallets ready
            </p>
            {total === 0 && (
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => router.push("/wallets/import")}>
                Import a Wallet
              </Button>
            )}
          </Panel>

          {/* Gas chart */}
          <Panel className="p-5 xl:col-span-4">
            <p className="label mb-4">
              Gas — {network === "base" ? "Base" : network === "robinhood" ? "Robinhood" : "Ethereum"}
            </p>
            <GasChart
              currentGwei={baseFee}
              priorityGwei={priority}
              maxFeeGwei={maxFee}
              gasLevel={gasLevel as "Low" | "Medium" | "High" | null}
              network={network}
              onNetworkChange={setNetwork}
            />
          </Panel>

          {/* RPC health */}
          <Panel className="p-5 xl:col-span-4">
            <div className="mb-4 flex items-center justify-between">
              <p className="label">RPC Health</p>
              <RadioTower size={14} style={{ color: "var(--text-3)" }} />
            </div>

            {rpcError ? (
              <p className="text-[12px] text-status-red-text">
                {rpcError instanceof Error ? rpcError.message : "Failed to load."}
              </p>
            ) : rpc.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-center">
                <RadioTower size={24} style={{ color: "var(--text-3)" }} />
                <p className="mt-2 text-[12px]" style={{ color: "var(--text-3)" }}>
                  No RPC endpoints configured.
                </p>
                <Button variant="secondary" size="sm" className="mt-3" onClick={() => router.push("/rpc-health")}>
                  Configure RPCs
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {rpc.slice(0, 5).map((r) => (
                  <div
                    key={r.endpointId}
                    className="flex items-center justify-between rounded-[6px] border px-3 py-2 text-[12px]"
                    style={{
                      background: "var(--surface-2)",
                      borderColor: "var(--border)",
                    }}
                  >
                    <span className="truncate" style={{ color: "var(--text-1)" }}>
                      {r.name}
                    </span>
                    <div className="ml-2 flex shrink-0 items-center gap-3">
                      <span
                        className={
                          r.status === "healthy"
                            ? "text-status-green-text"
                            : "text-status-red-text"
                        }
                      >
                        {r.status}
                      </span>
                      <span className="tabular-nums" style={{ color: "var(--text-3)" }}>
                        {r.latencyMs != null ? `${r.latencyMs}ms` : "—"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* Recent tasks */}
        <Panel>
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <p
                className="text-[13px] font-semibold tracking-tight"
                style={{ color: "var(--text-1)" }}
              >
                Recent Tasks
              </p>
              {tasks.length > 0 && (
                <Badge tone="neutral">{tasks.length}</Badge>
              )}
            </div>
            {tasks.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => router.push("/mint-tasks")}>
                View all
              </Button>
            )}
          </div>
          <TaskTimeline tasks={tasks} onNavigate={(href) => router.push(href)} />
        </Panel>

      </div>

      {showModal && (
        <ReadinessModal wallets={wallets} onClose={() => setShowModal(false)} />
      )}
    </AppShell>
  );
}
