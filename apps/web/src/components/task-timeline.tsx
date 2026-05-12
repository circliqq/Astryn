"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Badge, Button } from "./ui";
import { cn } from "@/lib/utils";

export interface TimelineTask {
  id: string;
  status: string;
  scheduledAt: string | null;
  createdAt: string;
  collection: { name: string; chain: string } | null;
}

// Stepper
const STEPS = ["DRAFT", "SCHEDULED", "RUNNING", "CONFIRMED"] as const;
const TERMINAL_OK   = ["COMPLETED", "CONFIRMED"];
const TERMINAL_FAIL = ["FAILED", "CANCELED"];

function stepIndex(status: string): number {
  if (TERMINAL_OK.includes(status))                     return 3;
  if (status === "RUNNING" || status === "PAUSED")      return 2;
  if (status === "SCHEDULED")                           return 1;
  return 0;
}

function TaskStepper({ status }: { status: string }) {
  const cur    = stepIndex(status);
  const failed = TERMINAL_FAIL.includes(status);

  return (
    <div className="flex items-center gap-1">
      {STEPS.map((_, idx) => {
        const done   = idx < cur;
        const active = idx === cur && !failed;
        const bad    = failed && idx === cur;

        return (
          <div key={idx} className="flex items-center gap-1">
            <div
              className={cn(
                "grid size-[18px] place-items-center rounded-full border text-[9px] font-bold",
                done   && "border-status-green-border  bg-status-green-bg   text-status-green-text",
                active && "border-status-blue-border   bg-status-blue-bg    text-status-blue-text",
                bad    && "border-status-red-border    bg-status-red-bg     text-status-red-text",
                !done && !active && !bad && "border-graphite-700 bg-graphite-800 text-graphite-500",
              )}
            >
              {done ? "✓" : bad ? "✕" : idx + 1}
            </div>
            {idx < STEPS.length - 1 && (
              <div className={cn("h-px w-3.5", done ? "bg-status-green-border" : "bg-graphite-700")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function relTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 0)           return `in ${Math.abs(Math.round(d / 60_000))}m`;
  if (d < 60_000)      return "just now";
  if (d < 3_600_000)   return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000)  return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

const BADGE_MAP: Record<string, { tone: "green" | "blue" | "yellow" | "red" | "neutral"; label: string }> = {
  DRAFT:     { tone: "neutral", label: "Draft"     },
  SCHEDULED: { tone: "blue", label: "Scheduled" },
  RUNNING:   { tone: "blue", label: "Running"   },
  PAUSED:    { tone: "yellow", label: "Paused"    },
  COMPLETED: { tone: "green", label: "Completed" },
  CONFIRMED: { tone: "green", label: "Confirmed" },
  FAILED:    { tone: "red", label: "Failed"    },
  CANCELED:  { tone: "yellow", label: "Canceled"  },
};

// Empty state
function EmptyTasks({ onNavigate }: { onNavigate?: (href: string) => void }) {
  return (
    <div className="flex flex-col items-center py-12 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-graphite-800">
        <RotateCcw size={20} className="text-graphite-500" />
      </div>
      <p className="mt-3 text-[13px] font-medium text-graphite-200">No mint tasks yet</p>
      <p className="mt-1 text-[12px] text-graphite-500">Create your first task to start automating mints.</p>
      {onNavigate && (
        <Button type="button" onClick={() => onNavigate("/mint-setup")} className="mt-4">
          Create Mint Task
        </Button>
      )}
    </div>
  );
}

// Main component
export function TaskTimeline({ tasks, onNavigate }: { tasks: TimelineTask[]; onNavigate?: (href: string) => void }) {
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: boolean }>(`/mint-tasks/${id}/retry`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mint-tasks"] }),
  });

  if (!tasks.length) return <EmptyTasks onNavigate={onNavigate} />;

  return (
    <div className="overflow-x-auto">
      <table className="data-table w-full min-w-[700px] text-left">
        <thead>
          <tr>
            {["Collection", "Network", "Status", "Progress", "Time", ""].map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.slice(0, 10).map((task) => {
            const bm = BADGE_MAP[task.status] ?? { tone: "neutral" as const, label: task.status };
            const canRetry = TERMINAL_FAIL.includes(task.status);
            return (
              <tr key={task.id}>
                <td className="font-medium">
                  {task.collection?.name ?? (
                    <span className="font-mono text-[11px] text-graphite-500">{task.id.slice(0, 8)}</span>
                  )}
                </td>
                <td className="text-[12px] text-graphite-400">
                  {task.collection?.chain === "BASE" ? "Base" : task.collection?.chain === "ETHEREUM" ? "Ethereum" : "—"}
                </td>
                <td><Badge tone={bm.tone}>{bm.label}</Badge></td>
                <td><TaskStepper status={task.status} /></td>
                <td className="text-[12px] text-graphite-500">{relTime(task.scheduledAt ?? task.createdAt)}</td>
                <td>
                  {canRetry && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-[11px] text-graphite-400 hover:text-graphite-100"
                      onClick={() => retry.mutate(task.id)}
                      disabled={retry.isPending && retry.variables === task.id}
                    >
                      <RotateCcw size={11} className={retry.isPending && retry.variables === task.id ? "animate-spin" : ""} />
                      Retry
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
