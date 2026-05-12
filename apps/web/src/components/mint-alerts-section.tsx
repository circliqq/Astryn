"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Bell,
  BellOff,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Badge, Button, Input, Panel, Select } from "./ui";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MintAlert {
  id: string;
  collectionSlug: string;
  collectionName: string;
  network: "BASE" | "ETHEREUM";
  mintStartTime: string;
  alertMinutes: number[];
  firedMinutes: number[];
  enabled: boolean;
  createdAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALERT_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 60, label: "1 hour before" },
  { minutes: 30, label: "30 min before" },
  { minutes: 15, label: "15 min before" },
  { minutes: 5,  label: "5 min before"  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCountdown(mintStartTime: string): string {
  const diff = new Date(mintStartTime).getTime() - Date.now();
  if (diff <= 0) return "Mint started";
  const totalSec = Math.floor(diff / 1000);
  const days = Math.floor(totalSec / 86400);
  const hrs  = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hrs}h ${mins}m`;
  if (hrs > 0)  return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Countdown ticker ──────────────────────────────────────────────────────────

function Countdown({ mintStartTime }: { mintStartTime: string }) {
  const [label, setLabel] = useState(() => formatCountdown(mintStartTime));
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setLabel(formatCountdown(mintStartTime));
    ref.current = setInterval(() => setLabel(formatCountdown(mintStartTime)), 1000);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [mintStartTime]);

  const isMintStarted = new Date(mintStartTime).getTime() <= Date.now();
  return (
    <span className={isMintStarted ? "text-graphite-500" : "tabular-nums text-brand"}>
      {label}
    </span>
  );
}

// ── Alert row ─────────────────────────────────────────────────────────────────

function AlertRow({ alert }: { alert: MintAlert }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const toggleMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/mint-alerts/${alert.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !alert.enabled }),
      }),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["mint-alerts"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Failed."),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/mint-alerts/${alert.id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mint-alerts"] }),
    onError: (e) => setError(e instanceof Error ? e.message : "Failed to delete."),
  });

  const isMintStarted = new Date(alert.mintStartTime).getTime() <= Date.now();

  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-graphite-700 bg-graphite-800/40 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {/* Left: info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-graphite-100">{alert.collectionName}</span>
            <span className="font-mono text-[11px] text-graphite-500">{alert.collectionSlug}</span>
            <Badge tone="blue">{alert.network === "ETHEREUM" ? "Ethereum" : "Base"}</Badge>
            <Badge tone={alert.enabled ? "green" : "slate"}>
              {alert.enabled ? "Active" : "Paused"}
            </Badge>
          </div>

          {/* Mint time + countdown */}
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[12px]">
            <span className="text-graphite-400">
              <Clock size={11} className="mr-1 inline" />
              {formatDateTime(alert.mintStartTime)}
            </span>
            {!isMintStarted && (
              <span className="text-graphite-400">
                Starts in: <Countdown mintStartTime={alert.mintStartTime} />
              </span>
            )}
          </div>

          {/* Alert intervals */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ALERT_OPTIONS.map(({ minutes, label }) => {
              const isSet    = alert.alertMinutes.includes(minutes);
              const isFired  = alert.firedMinutes.includes(minutes);
              if (!isSet) return null;
              return (
                <span
                  key={minutes}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border
                    ${isFired
                      ? "border-graphite-600 bg-graphite-700 text-graphite-400 line-through"
                      : "border-brand/30 bg-brand/10 text-brand"
                    }`}
                >
                  <Bell size={9} />
                  {label}
                  {isFired && <span className="ml-0.5 no-underline text-status-green-text">✓</span>}
                </span>
              );
            })}
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex shrink-0 gap-2">
          <Button
            variant="secondary"
            className="h-8 gap-1.5 px-3 text-[12px]"
            onClick={() => toggleMutation.mutate()}
            disabled={toggleMutation.isPending || deleteMutation.isPending}
          >
            {toggleMutation.isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : alert.enabled ? (
              <><BellOff size={13} /> Pause</>
            ) : (
              <><Bell size={13} /> Enable</>
            )}
          </Button>
          <Button
            variant="ghost"
            className="size-8 px-0 text-status-red-text hover:bg-status-red-bg"
            onClick={() => {
              if (!window.confirm(`Delete alert for "${alert.collectionName}"?`)) return;
              deleteMutation.mutate();
            }}
            disabled={deleteMutation.isPending || toggleMutation.isPending}
          >
            {deleteMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-[12px] text-status-red-text">
          <AlertCircle size={12} /> {error}
        </div>
      )}
    </div>
  );
}

// ── Add alert form ────────────────────────────────────────────────────────────

function AddAlertForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug]             = useState("");
  const [name, setName]             = useState("");
  const [network, setNetwork]       = useState<"BASE" | "ETHEREUM">("ETHEREUM");
  const [mintTime, setMintTime]     = useState("");
  const [selected, setSelected]     = useState<number[]>([60, 30, 15, 5]);
  const [formError, setFormError]   = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch("/mint-alerts", {
        method: "POST",
        body: JSON.stringify({
          collectionSlug: slug.trim(),
          collectionName: name.trim() || slug.trim(),
          network,
          mintStartTime: new Date(mintTime).toISOString(),
          alertMinutes: selected,
        }),
      }),
    onSuccess: () => {
      setSlug(""); setName(""); setMintTime("");
      setSelected([60, 30, 15, 5]);
      setFormError(null);
      setOpen(false);
      onCreated();
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : "Failed to create alert."),
  });

  function toggleInterval(minutes: number) {
    setSelected((prev) =>
      prev.includes(minutes) ? prev.filter((m) => m !== minutes) : [...prev, minutes]
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!slug.trim()) return setFormError("Collection slug is required.");
    if (!mintTime)    return setFormError("Mint start time is required.");
    if (selected.length === 0) return setFormError("Select at least one alert interval.");
    if (new Date(mintTime) <= new Date()) return setFormError("Mint time must be in the future.");
    mutation.mutate();
  }

  return (
    <Panel>
      <button
        type="button"
        className="flex w-full items-center justify-between p-4"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <div className="grid size-8 place-items-center rounded-md bg-graphite-800">
            <Plus size={15} className="text-graphite-400" />
          </div>
          <div className="text-left">
            <p className="text-[13px] font-semibold text-graphite-100">Add Mint Alert</p>
            <p className="text-[12px] text-graphite-500">
              Get notified 1h, 30m, 15m, or 5m before a mint starts.
            </p>
          </div>
        </div>
        {open
          ? <ChevronUp size={15} className="shrink-0 text-graphite-400" />
          : <ChevronDown size={15} className="shrink-0 text-graphite-400" />}
      </button>

      {open && (
        <form
          className="border-t border-graphite-700 px-4 pb-4 pt-4 space-y-4"
          onSubmit={handleSubmit}
        >
          {/* Row 1: slug + name */}
          <div className="grid gap-3 md:grid-cols-2">
            <label>
              <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                Collection Slug <span className="text-graphite-600">(OpenSea slug)</span>
              </span>
              <Input
                placeholder="e.g. projectryujin"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                Collection Name <span className="text-graphite-600">(display label)</span>
              </span>
              <Input
                placeholder="e.g. Project Ryujin"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          </div>

          {/* Row 2: network + mint time */}
          <div className="grid gap-3 md:grid-cols-2">
            <label>
              <span className="mb-1 block text-[11px] font-medium text-graphite-400">Network</span>
              <Select
                value={network}
                onChange={(e) => setNetwork(e.target.value as "BASE" | "ETHEREUM")}
              >
                <option value="ETHEREUM">Ethereum</option>
                <option value="BASE">Base</option>
              </Select>
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                Mint Start Time
              </span>
              <Input
                type="datetime-local"
                value={mintTime}
                onChange={(e) => setMintTime(e.target.value)}
              />
            </label>
          </div>

          {/* Alert intervals */}
          <div>
            <p className="mb-2 text-[11px] font-medium text-graphite-400">Alert me before mint</p>
            <div className="flex flex-wrap gap-2">
              {ALERT_OPTIONS.map(({ minutes, label }) => {
                const isOn = selected.includes(minutes);
                return (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => toggleInterval(minutes)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors
                      ${isOn
                        ? "border-brand bg-brand/15 text-brand"
                        : "border-graphite-600 bg-graphite-800 text-graphite-400 hover:border-graphite-500 hover:text-graphite-200"
                      }`}
                  >
                    <Bell size={11} />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {formError && (
            <div className="flex items-center gap-2 rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-[12px] text-status-red-text">
              <AlertCircle size={13} /> {formError}
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <><Loader2 size={14} className="animate-spin" /> Creating…</>
              ) : (
                <><Bell size={14} /> Add Alert</>
              )}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => { setOpen(false); setFormError(null); }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

// ── Main section ──────────────────────────────────────────────────────────────

export function MintAlertsSection() {
  const qc = useQueryClient();
  const [sectionOpen, setSectionOpen] = useState(true);

  const { data: alerts = [], isLoading } = useQuery<MintAlert[]>({
    queryKey: ["mint-alerts"],
    queryFn: () => apiFetch<MintAlert[]>("/mint-alerts"),
    refetchInterval: 60_000,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["mint-alerts"] });
  }

  const upcoming = alerts.filter((a) => new Date(a.mintStartTime).getTime() > Date.now());
  const past     = alerts.filter((a) => new Date(a.mintStartTime).getTime() <= Date.now());

  return (
    <div className="space-y-3">
      {/* Section header */}
      <button
        type="button"
        className="flex w-full items-center justify-between"
        onClick={() => setSectionOpen((o) => !o)}
      >
        <div className="flex items-center gap-2">
          <Bell size={15} className="text-brand" />
          <h2 className="text-[14px] font-semibold text-graphite-100">Mint Alerts</h2>
          {alerts.length > 0 && (
            <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-medium text-brand">
              {upcoming.length} upcoming
            </span>
          )}
        </div>
        {sectionOpen
          ? <ChevronUp size={14} className="text-graphite-500" />
          : <ChevronDown size={14} className="text-graphite-500" />}
      </button>

      {sectionOpen && (
        <div className="space-y-3">
          {/* Add form */}
          <AddAlertForm onCreated={refresh} />

          {/* Loading */}
          {isLoading && (
            <Panel className="flex items-center gap-2 p-5 text-[13px] text-graphite-400">
              <Loader2 size={15} className="animate-spin" />
              Loading alerts…
            </Panel>
          )}

          {/* Empty */}
          {!isLoading && alerts.length === 0 && (
            <Panel>
              <div className="flex flex-col items-center px-6 py-10 text-center">
                <div className="grid size-[48px] place-items-center rounded-full bg-[#1E2028]">
                  <Bell size={20} className="text-graphite-500" />
                </div>
                <p className="mt-3 text-[13px] font-medium text-graphite-200">No mint alerts yet</p>
                <p className="mt-1 text-[12px] text-graphite-500">
                  Add an alert above and get notified before any mint starts.
                </p>
              </div>
            </Panel>
          )}

          {/* Upcoming alerts */}
          {upcoming.length > 0 && (
            <div className="space-y-2">
              <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-graphite-500">
                Upcoming
              </p>
              {upcoming.map((alert) => (
                <AlertRow key={alert.id} alert={alert} />
              ))}
            </div>
          )}

          {/* Past alerts */}
          {past.length > 0 && (
            <div className="space-y-2">
              <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-graphite-500">
                Past / Completed
              </p>
              {past.map((alert) => (
                <AlertRow key={alert.id} alert={alert} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
