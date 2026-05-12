"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Clock,
  ListTodo,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat2,
  Save,
  X,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel, Select } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { GAS_PRESETS, type GasMode } from "@/lib/gas-settings";

type TaskStatus = "DRAFT" | "SCHEDULED" | "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED" | "CANCELED";
type PhaseType = "PUBLIC" | "ALLOWLIST" | "GTD" | "FCFS";

interface InstantFlipperJson {
  enabled?: boolean;
  mode?: "auto" | "manual";
  priceMode?: "floor_percent" | "fixed";
  floorMultiplier?: number;
  fixedPriceEth?: number;
  minPriceEth?: number;
  maxPerWallet?: number;
}

interface MintTask {
  id: string;
  status: TaskStatus;
  phaseType: PhaseType;
  mintQuantity: number;
  gasSettingsJson: { mode?: GasMode; maxFeeGwei?: number; priorityFeeGwei?: number } | null;
  instantFlipperJson: InstantFlipperJson | null;
  scheduledAt: string | null;
  createdAt: string;
  collection: { id: string; name: string; chain: "BASE" | "ETHEREUM"; slug: string };
  wallets: Array<{ walletId: string }>;
}

const statusConfig: Record<TaskStatus, { tone: "green" | "blue" | "yellow" | "red" | "slate"; label: string }> = {
  DRAFT:     { tone: "slate",  label: "Draft"     },
  SCHEDULED: { tone: "blue",   label: "Scheduled" },
  RUNNING:   { tone: "green",  label: "Running"   },
  PAUSED:    { tone: "yellow", label: "Paused"    },
  COMPLETED: { tone: "green",  label: "Completed" },
  FAILED:    { tone: "red",    label: "Failed"    },
  CANCELED:  { tone: "red",    label: "Canceled"  },
};

function timeLabel(iso: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  if (abs < 60_000) return "< 1 min";
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m${ms < 0 ? " ago" : ""}`;
  if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)}h${ms < 0 ? " ago" : ""}`;
  return new Date(iso).toLocaleString();
}

export default function MintTasksPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data: tasks = [], isLoading } = useQuery<MintTask[]>({
    queryKey: ["mint-tasks"],
    queryFn: () => apiFetch<MintTask[]>("/mint-tasks"),
    refetchInterval: 15_000,
  });

  return (
    <AppShell title="Mint Tasks">
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <p className="text-[13px] text-graphite-400">
            {tasks.length} task{tasks.length !== 1 ? "s" : ""} total
          </p>
          <Button onClick={() => router.push("/scanner")}>
            <Plus size={15} /> New Mint Task
          </Button>
        </div>

        {isLoading && (
          <Panel className="p-8 text-center text-sm text-graphite-400">
            <RefreshCw size={20} className="mx-auto mb-3 animate-spin" />
            Loading tasks…
          </Panel>
        )}

        {!isLoading && tasks.length === 0 && (
          <Panel>
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <div className="grid size-[52px] place-items-center rounded-full bg-[#1E2028]">
                <ListTodo size={24} className="text-graphite-500" />
              </div>
              <p className="mt-3 text-[13px] font-medium text-graphite-200">No mint tasks yet</p>
              <p className="mt-1 text-[12px] text-graphite-500">
                Scan a collection from the{" "}
                <a href="/scanner" className="text-brand hover:underline">Collection Scanner</a>{" "}
                to create your first task.
              </p>
            </div>
          </Panel>
        )}

        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            onRefresh={() => qc.invalidateQueries({ queryKey: ["mint-tasks"] })}
          />
        ))}
      </div>
    </AppShell>
  );
}

// ── Edit form state ───────────────────────────────────────────────────────────

interface EditDraft {
  phaseType: PhaseType;
  gasMode: GasMode;
  mintQuantity: string;
  scheduleMode: "draft" | "custom";
  scheduledAt: string;
}

function initEditDraft(task: MintTask): EditDraft {
  const savedMode = (task.gasSettingsJson?.mode ?? "balanced") as GasMode;
  return {
    phaseType: task.phaseType,
    gasMode: savedMode,
    mintQuantity: String(task.mintQuantity ?? 1),
    scheduleMode: task.scheduledAt ? "custom" : "draft",
    scheduledAt: task.scheduledAt
      ? new Date(task.scheduledAt).toISOString().slice(0, 16)
      : "",
  };
}

// ── TaskRow ───────────────────────────────────────────────────────────────────

function TaskRow({ task, onRefresh }: { task: MintTask; onRefresh: () => void }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditDraft>(() => initEditDraft(task));
  const [saveError, setSaveError] = useState<string | null>(null);

  const cfg = statusConfig[task.status] ?? { tone: "slate" as const, label: task.status };
  const canPause  = task.status === "SCHEDULED" || task.status === "RUNNING";
  const canResume = task.status === "PAUSED";
  const canCancel = !["CANCELED", "COMPLETED", "FAILED"].includes(task.status);
  const canEdit   = ["DRAFT", "SCHEDULED", "PAUSED"].includes(task.status);

  const flipper = task.instantFlipperJson;
  const flipperActive = flipper?.enabled === true;
  const isManualFlip  = flipperActive && flipper?.mode === "manual";
  const canFlip       = isManualFlip && task.status === "COMPLETED";

  const flipMutation = useMutation({
    mutationFn: () => apiFetch(`/mint-tasks/${task.id}/flip`, { method: "POST" }),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["mint-tasks"] });
      onRefresh();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Flip failed"),
  });

  async function doAction(action: "pause" | "resume" | "cancel") {
    setPending(action);
    setError(null);
    try {
      await apiFetch(`/mint-tasks/${task.id}/${action}`, { method: "POST" });
      qc.invalidateQueries({ queryKey: ["mint-tasks"] });
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setPending(null);
    }
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const gasSettings = GAS_PRESETS[draft.gasMode];
      const body: Record<string, unknown> = {
        phaseType: draft.phaseType,
        gasSettings,
        mintQuantity: Math.max(1, Number.parseInt(draft.mintQuantity, 10) || 1),
      };
      if (draft.scheduleMode === "draft") {
        body.scheduleMode = "draft";
      } else if (draft.scheduleMode === "custom" && draft.scheduledAt) {
        body.scheduledAt = new Date(draft.scheduledAt).toISOString();
      }
      return apiFetch(`/mint-tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      setEditing(false);
      setSaveError(null);
      qc.invalidateQueries({ queryKey: ["mint-tasks"] });
      onRefresh();
    },
    onError: (err) => setSaveError(err instanceof Error ? err.message : "Save failed"),
  });

  function openEdit() {
    setDraft(initEditDraft(task));
    setSaveError(null);
    setEditing(true);
  }

  return (
    <Panel className="p-5">
      {/* ── Main row ── */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        {/* Left */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-graphite-500">{task.id.slice(0, 8)}</span>
            <Badge tone={cfg.tone}>{cfg.label}</Badge>
            <Badge tone="blue">{task.collection.chain}</Badge>
            <span className="text-xs uppercase text-graphite-500">{task.phaseType}</span>
            {flipperActive && (
              <Badge tone={isManualFlip ? "yellow" : "green"}>
                <Repeat2 size={10} className="mr-1 inline" />
                {isManualFlip ? "Manual Flip" : "Auto Flip"}
              </Badge>
            )}
          </div>
          <p className="mt-2 font-semibold">{task.collection.name}</p>
          <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-graphite-400">
            <span className="flex items-center gap-1">
              <Clock size={12} />
              {task.status === "SCHEDULED"
                ? `Fires in ${timeLabel(task.scheduledAt)}`
                : task.scheduledAt
                ? `Scheduled: ${timeLabel(task.scheduledAt)}`
                : `Created ${timeLabel(task.createdAt)}`}
            </span>
            <span>{task.wallets.length} wallet{task.wallets.length !== 1 ? "s" : ""}</span>
            {task.gasSettingsJson?.mode && (
              <span className="capitalize">Gas: {task.gasSettingsJson.mode}</span>
            )}
            {task.mintQuantity > 1 && <span>Qty: {task.mintQuantity}</span>}
          </div>
        </div>

        {/* Right — actions */}
        <div className="flex shrink-0 flex-wrap gap-2">
          {canEdit && (
            <Button
              variant="secondary"
              onClick={editing ? () => setEditing(false) : openEdit}
              disabled={!!pending}
            >
              {editing ? <><X size={14} /> Close</> : <><Pencil size={14} /> Edit</>}
            </Button>
          )}
          {canPause && (
            <Button variant="secondary" onClick={() => doAction("pause")} disabled={!!pending}>
              <Pause size={14} /> {pending === "pause" ? "Pausing…" : "Pause"}
            </Button>
          )}
          {canResume && (
            <Button onClick={() => doAction("resume")} disabled={!!pending}>
              <Play size={14} /> {pending === "resume" ? "Resuming…" : "Resume"}
            </Button>
          )}
          {canCancel && (
            <Button variant="secondary" onClick={() => doAction("cancel")} disabled={!!pending}>
              <XCircle size={14} /> {pending === "cancel" ? "Canceling…" : "Cancel"}
            </Button>
          )}
          {canFlip && (
            <Button
              onClick={() => flipMutation.mutate()}
              disabled={flipMutation.isPending || !!pending}
              className="gap-1.5"
            >
              {flipMutation.isPending
                ? <><Loader2 size={14} className="animate-spin" /> Flipping…</>
                : <><Repeat2 size={14} /> Flip Now</>}
            </Button>
          )}
        </div>
      </div>

      {/* ── Action error ── */}
      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-[12px] text-status-red-text">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {/* ── Inline edit panel ── */}
      {editing && (
        <div className="mt-4 border-t border-graphite-700 pt-4">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-graphite-400">
            Edit Task
          </p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {/* Phase */}
            <label>
              <span className="mb-1 block text-[11px] font-medium text-graphite-400">Phase</span>
              <Select
                value={draft.phaseType}
                onChange={(e) => setDraft((d) => ({ ...d, phaseType: e.target.value as PhaseType }))}
              >
                {(["PUBLIC", "ALLOWLIST", "GTD", "FCFS"] as const).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </Select>
            </label>

            {/* Gas mode */}
            <label>
              <span className="mb-1 block text-[11px] font-medium text-graphite-400">Gas mode</span>
              <Select
                value={draft.gasMode}
                onChange={(e) => setDraft((d) => ({ ...d, gasMode: e.target.value as GasMode }))}
              >
                <option value="safe">Safe</option>
                <option value="balanced">Balanced</option>
                <option value="aggressive">Aggressive</option>
              </Select>
            </label>

            {/* Quantity */}
            <label>
              <span className="mb-1 block text-[11px] font-medium text-graphite-400">Mint quantity</span>
              <Input
                type="number"
                min="1"
                value={draft.mintQuantity}
                onChange={(e) => setDraft((d) => ({ ...d, mintQuantity: e.target.value }))}
              />
            </label>

            {/* Schedule mode */}
            <label>
              <span className="mb-1 block text-[11px] font-medium text-graphite-400">Schedule</span>
              <Select
                value={draft.scheduleMode}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, scheduleMode: e.target.value as EditDraft["scheduleMode"] }))
                }
              >
                <option value="draft">Draft (no schedule)</option>
                <option value="custom">Custom time</option>
              </Select>
            </label>
          </div>

          {/* Custom datetime picker */}
          {draft.scheduleMode === "custom" && (
            <div className="mt-3">
              <label>
                <span className="mb-1 block text-[11px] font-medium text-graphite-400">Schedule at</span>
                <Input
                  type="datetime-local"
                  value={draft.scheduledAt}
                  onChange={(e) => setDraft((d) => ({ ...d, scheduledAt: e.target.value }))}
                  className="max-w-xs"
                />
              </label>
            </div>
          )}

          {/* Gas preview strip */}
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-graphite-700 bg-graphite-800/60 px-3 py-2 text-[11px] text-graphite-400">
            <span className="font-medium capitalize text-graphite-300">{draft.gasMode}</span>
            <span>Max fee: {GAS_PRESETS[draft.gasMode].maxFeeGwei} gwei</span>
            <span>Priority: {GAS_PRESETS[draft.gasMode].priorityFeeGwei} gwei</span>
            <span>Cap: {GAS_PRESETS[draft.gasMode].maxTotalGasCostEth} ETH</span>
            <span>Bumps: {GAS_PRESETS[draft.gasMode].maxBumpAttempts}×</span>
          </div>

          {saveError && (
            <div className="mt-2 flex items-center gap-2 rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-[12px] text-status-red-text">
              <AlertCircle size={13} /> {saveError}
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              <Save size={14} /> {saveMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
