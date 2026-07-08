"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FlaskConical,
  Loader2,
  Plus,
  Search,
  TrendingDown,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel, Select } from "@/components/ui";
import { apiFetch } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SweepDetection {
  id: string;
  itemCount: number;
  windowSeconds: number;
  detectedAt: string;
  salePricesJson: number[] | null;
}

interface SweepAlert {
  id: string;
  collectionSlug: string;
  network: "BASE" | "ETHEREUM" | "ROBINHOOD";
  minItems: number;
  windowSeconds: number;
  enabled: boolean;
  lastTriggeredAt: string | null;
  createdAt: string;
  detections: SweepDetection[];
}

interface ProfileCollection {
  slug: string;
  name: string;
  imageUrl: string | null;
  ownedCount: number | null;
}

interface ProfileImportResult {
  walletAddress: string;
  network: "BASE" | "ETHEREUM" | "ROBINHOOD";
  collectionCount: number;
  collections: ProfileCollection[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function minMaxEth(prices: number[] | null): string {
  if (!prices || prices.length === 0) return "—";
  const min = Math.min(...prices).toFixed(4);
  const max = Math.max(...prices).toFixed(4);
  return min === max ? `${min} ETH` : `${min}–${max} ETH`;
}

function windowLabel(seconds: number): string {
  return seconds >= 60 ? `${seconds / 60}min` : `${seconds}s`;
}

// ── Profile Import Panel ──────────────────────────────────────────────────────

function ProfileImportPanel({ existingSlugs, onImported }: {
  existingSlugs: Set<string>;
  onImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [profileUrl, setProfileUrl] = useState("");
  const [network, setNetwork] = useState<"BASE" | "ETHEREUM" | "ROBINHOOD">("ETHEREUM");
  const [minItems, setMinItems] = useState("5");
  const [windowSeconds, setWindowSeconds] = useState("60");
  const [profileResult, setProfileResult] = useState<ProfileImportResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");

  const fetchMutation = useMutation({
    mutationFn: () =>
      apiFetch<ProfileImportResult>(
        `/sweep-alerts/import/profile?url=${encodeURIComponent(profileUrl.trim())}&network=${network}`,
      ),
    onSuccess: (data) => {
      setProfileResult(data);
      setFetchError(null);
      // Start with nothing selected — user picks which collections to track
      setSelected(new Set());
    },
    onError: (err) => {
      setFetchError(err instanceof Error ? err.message : "Failed to fetch profile.");
      setProfileResult(null);
    },
  });

  const batchMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ created: number; failed: number; total: number }>("/sweep-alerts/batch", {
        method: "POST",
        body: JSON.stringify({
          alerts: Array.from(selected).map((slug) => ({ collectionSlug: slug, network })),
          defaultMinItems: Math.max(2, Number.parseInt(minItems, 10) || 5),
          defaultWindowSeconds: Math.max(10, Number.parseInt(windowSeconds, 10) || 60),
        }),
      }),
    onSuccess: (res) => {
      setImportError(null);
      setProfileResult(null);
      setSelected(new Set());
      setProfileUrl("");
      setOpen(false);
      onImported();
      if (res.failed > 0) setImportError(`${res.created} created, ${res.failed} failed.`);
    },
    onError: (err) => setImportError(err instanceof Error ? err.message : "Import failed."),
  });

  function toggleAll() {
    if (!profileResult) return;
    const untracked = profileResult.collections
      .filter((c) => !existingSlugs.has(c.slug))
      .map((c) => c.slug);
    if (selected.size === untracked.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(untracked));
    }
  }

  const filtered = profileResult?.collections.filter((c) =>
    !searchFilter || c.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
    c.slug.toLowerCase().includes(searchFilter.toLowerCase()),
  ) ?? [];

  return (
    <Panel>
      <button
        type="button"
        className="flex w-full items-center justify-between p-5"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <div className="grid size-8 place-items-center rounded-md" style={{ background: "var(--surface-2)" }}>
            <Users size={15} className="text-brand" />
          </div>
          <div className="text-left">
            <p className="text-[14px] font-semibold" style={{ color: "var(--text-1)" }}>
              Import from OpenSea Profile
            </p>
            <p className="text-[12px]" style={{ color: "var(--text-3)" }}>
              Paste a profile URL, username or wallet — pick which collections to track.
            </p>
          </div>
        </div>
        {open
          ? <ChevronUp size={16} className="shrink-0" style={{ color: "var(--text-3)" }} />
          : <ChevronDown size={16} className="shrink-0" style={{ color: "var(--text-3)" }} />}
      </button>

      {open && (
        <div className="border-t px-5 pb-5 pt-4 space-y-4" style={{ borderColor: "var(--border)" }}>
          {/* Input row */}
          <div className="grid gap-3 md:grid-cols-[1fr_160px_120px_120px_auto]">
            <label>
              <span className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-3)" }}>
                OpenSea URL / username / address
              </span>
              <Input
                placeholder="https://opensea.io/TMA420  or  0xdbd4…"
                value={profileUrl}
                onChange={(e) => { setProfileUrl(e.target.value); setProfileResult(null); }}
              />
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-3)" }}>Network</span>
              <Select value={network} onChange={(e) => setNetwork(e.target.value as "BASE" | "ETHEREUM" | "ROBINHOOD")}>
                <option value="ETHEREUM">Ethereum</option>
                <option value="BASE">Base</option>
                <option value="ROBINHOOD">Robinhood</option>
              </Select>
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-3)" }}>Min items</span>
              <Input type="number" min="2" max="200" value={minItems} onChange={(e) => setMinItems(e.target.value)} />
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-3)" }}>Window</span>
              <Select value={windowSeconds} onChange={(e) => setWindowSeconds(e.target.value)}>
                <option value="30">30s</option>
                <option value="60">60s</option>
                <option value="120">2 min</option>
                <option value="300">5 min</option>
                <option value="600">10 min</option>
              </Select>
            </label>
            <div className="flex items-end">
              <Button
                onClick={() => { setFetchError(null); fetchMutation.mutate(); }}
                disabled={!profileUrl.trim() || fetchMutation.isPending}
              >
                {fetchMutation.isPending
                  ? <><Loader2 size={14} className="animate-spin" /> Fetching…</>
                  : <><Search size={14} /> Fetch</>}
              </Button>
            </div>
          </div>

          {fetchError && (
            <div className="flex items-center gap-2 rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-[12px] text-status-red-text">
              <AlertCircle size={13} /> {fetchError}
            </div>
          )}

          {/* Collection picker */}
          {profileResult && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-[12px]" style={{ color: "var(--text-3)" }}>
                  Found <strong style={{ color: "var(--text-2)" }}>{profileResult.collectionCount}</strong> collections
                  for <span className="font-mono" style={{ color: "var(--text-2)" }}>{profileResult.walletAddress.slice(0, 10)}…</span>
                  {" · "}
                  <button
                    type="button"
                    className="text-brand underline underline-offset-2 hover:text-brand/80"
                    onClick={toggleAll}
                  >
                    {selected.size === profileResult.collections.filter((c) => !existingSlugs.has(c.slug)).length
                      ? "Deselect all"
                      : "Select all new"}
                  </button>
                  {" · "}
                  <span style={{ color: "var(--text-2)" }}>{selected.size} selected</span>
                </div>
                <Input
                  placeholder="Filter collections…"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="w-48"
                />
              </div>

              <div className="max-h-72 overflow-y-auto rounded-md border" style={{ borderColor: "var(--border)" }}>
                {filtered.length === 0 ? (
                  <p className="p-4 text-center text-[12px]" style={{ color: "var(--text-3)" }}>No collections match.</p>
                ) : (
                  <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                    {filtered.map((col) => {
                      const alreadyTracked = existingSlugs.has(col.slug);
                      const isSelected = selected.has(col.slug);
                      return (
                        <label
                          key={col.slug}
                          className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors
                            ${alreadyTracked ? "opacity-50 cursor-not-allowed" : ""}`}
                          style={!alreadyTracked ? undefined : undefined}
                        >
                          <input
                            type="checkbox"
                            className="accent-brand"
                            checked={isSelected}
                            disabled={alreadyTracked}
                            onChange={() => {
                              if (alreadyTracked) return;
                              setSelected((prev) => {
                                const next = new Set(prev);
                                next.has(col.slug) ? next.delete(col.slug) : next.add(col.slug);
                                return next;
                              });
                            }}
                          />
                          {col.imageUrl ? (
                            <img
                              src={col.imageUrl}
                              alt={col.name}
                              className="size-8 rounded-md object-cover border"
                              style={{ borderColor: "var(--border)" }}
                            />
                          ) : (
                            <div className="size-8 rounded-md" style={{ background: "var(--surface-3)" }} />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium" style={{ color: "var(--text-1)" }}>{col.name}</p>
                            <p className="text-[11px]" style={{ color: "var(--text-3)" }}>{col.slug}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {col.ownedCount != null && (
                              <span className="text-[11px]" style={{ color: "var(--text-3)" }}>{col.ownedCount} held</span>
                            )}
                            {alreadyTracked && (
                              <Badge tone="green">Tracked</Badge>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              {importError && (
                <div className="flex items-center gap-2 rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-[12px] text-status-red-text">
                  <AlertCircle size={13} /> {importError}
                </div>
              )}

              <div className="flex items-center gap-3">
                <Button
                  onClick={() => batchMutation.mutate()}
                  disabled={selected.size === 0 || batchMutation.isPending}
                >
                  {batchMutation.isPending
                    ? <><Loader2 size={14} className="animate-spin" /> Creating…</>
                    : <><Plus size={14} /> Create {selected.size} alert{selected.size !== 1 ? "s" : ""}</>}
                </Button>
                <span className="text-[12px]" style={{ color: "var(--text-3)" }}>
                  Each alert: {minItems}+ items swept in {windowLabel(Number(windowSeconds))}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ── Create single alert form ──────────────────────────────────────────────────

function CreateAlertForm({ onCreated }: { onCreated: () => void }) {
  const [slug, setSlug] = useState("");
  const [network, setNetwork] = useState<"BASE" | "ETHEREUM" | "ROBINHOOD">("ETHEREUM");
  const [minItems, setMinItems] = useState("5");
  const [windowSeconds, setWindowSeconds] = useState("60");
  const [formError, setFormError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch("/sweep-alerts", {
        method: "POST",
        body: JSON.stringify({
          collectionSlug: slug.trim(),
          network,
          minItems: Math.max(2, Number.parseInt(minItems, 10) || 5),
          windowSeconds: Math.max(10, Number.parseInt(windowSeconds, 10) || 60),
        }),
      }),
    onSuccess: () => {
      setSlug(""); setMinItems("5"); setWindowSeconds("60");
      setFormError(null); setOpen(false);
      onCreated();
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : "Failed to create alert."),
  });

  return (
    <Panel>
      <button
        type="button"
        className="flex w-full items-center justify-between p-5"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <div className="grid size-8 place-items-center rounded-md" style={{ background: "var(--surface-2)" }}>
            <Plus size={15} style={{ color: "var(--text-3)" }} />
          </div>
          <div className="text-left">
            <p className="text-[14px] font-semibold" style={{ color: "var(--text-1)" }}>Add Single Alert</p>
            <p className="text-[12px]" style={{ color: "var(--text-3)" }}>Track one collection by slug.</p>
          </div>
        </div>
        {open
          ? <ChevronUp size={16} className="shrink-0" style={{ color: "var(--text-3)" }} />
          : <ChevronDown size={16} className="shrink-0" style={{ color: "var(--text-3)" }} />}
      </button>

      {open && (
        <div className="border-t px-5 pb-5 pt-4" style={{ borderColor: "var(--border)" }}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="xl:col-span-2">
              <span className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-3)" }}>Collection slug</span>
              <Input placeholder="e.g. projectryujin" value={slug} onChange={(e) => setSlug(e.target.value)} />
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-3)" }}>Network</span>
              <Select value={network} onChange={(e) => setNetwork(e.target.value as "BASE" | "ETHEREUM" | "ROBINHOOD")}>
                <option value="ETHEREUM">Ethereum</option>
                <option value="BASE">Base</option>
                <option value="ROBINHOOD">Robinhood</option>
              </Select>
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-3)" }}>Min items</span>
              <Input type="number" min="2" max="200" value={minItems} onChange={(e) => setMinItems(e.target.value)} />
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-3)" }}>Window</span>
              <Select value={windowSeconds} onChange={(e) => setWindowSeconds(e.target.value)}>
                <option value="30">30s</option>
                <option value="60">60s</option>
                <option value="120">2 min</option>
                <option value="300">5 min</option>
                <option value="600">10 min</option>
              </Select>
            </label>
            <div className="flex items-end">
              <div className="space-y-2 w-full">
                <div className="notice text-[12px]">
                  Alert when <strong>{minItems}+</strong> items sold in{" "}
                  <strong>{windowLabel(Number(windowSeconds))}</strong>.
                </div>
                <Button onClick={() => { if (!slug.trim()) { setFormError("Enter a collection slug."); return; } mutation.mutate(); }} disabled={mutation.isPending}>
                  {mutation.isPending ? <><Loader2 size={14} className="animate-spin" /> Creating…</> : <><Plus size={14} /> Add Alert</>}
                </Button>
              </div>
            </div>
          </div>
          {formError && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-[12px] text-status-red-text">
              <AlertCircle size={13} /> {formError}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ── Alert card ────────────────────────────────────────────────────────────────

function AlertCard({ alert, onRefresh }: { alert: SweepAlert; onRefresh: () => void }) {
  const qc = useQueryClient();
  const [checkResult, setCheckResult] = useState<{ detected: boolean; itemCount: number; salePrices: number[] } | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleMutation = useMutation({
    mutationFn: () => apiFetch(`/sweep-alerts/${alert.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !alert.enabled }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sweep-alerts"] }),
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to toggle."),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/sweep-alerts/${alert.id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sweep-alerts"] }),
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to delete."),
  });

  async function runCheck() {
    setChecking(true); setCheckResult(null); setError(null);
    try {
      const result = await apiFetch<{ detected: boolean; itemCount: number; salePrices: number[] }>(
        `/sweep-alerts/${alert.id}/check`, { method: "POST" },
      );
      setCheckResult(result);
      qc.invalidateQueries({ queryKey: ["sweep-alerts"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Check failed.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <Panel className="p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`https://opensea.io/collection/${alert.collectionSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 font-semibold hover:text-brand"
              style={{ color: "var(--text-1)" }}
            >
              {alert.collectionSlug}
              <ExternalLink size={11} style={{ color: "var(--text-3)" }} />
            </a>
            <Badge tone="blue">{alert.network === "ETHEREUM" ? "Ethereum" : alert.network === "ROBINHOOD" ? "Robinhood" : "Base"}</Badge>
            <Badge tone={alert.enabled ? "green" : "slate"}>{alert.enabled ? "Active" : "Paused"}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-[12px]" style={{ color: "var(--text-3)" }}>
            <span>
              Trigger: <strong style={{ color: "var(--text-2)" }}>{alert.minItems}+ items</strong> in{" "}
              <strong style={{ color: "var(--text-2)" }}>{windowLabel(alert.windowSeconds)}</strong>
            </span>
            <span>{alert.detections.length > 0 ? `${alert.detections.length} detection${alert.detections.length !== 1 ? "s" : ""}` : "No detections yet"}</span>
            {alert.lastTriggeredAt && <span>Last hit: {timeAgo(alert.lastTriggeredAt)}</span>}
          </div>

          {alert.detections.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {alert.detections.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-3 rounded-md border px-3 py-1.5 text-[11px]"
                  style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
                >
                  <AlertTriangle size={11} className="text-amber-400 shrink-0" />
                  <span className="text-amber-300 font-medium">{d.itemCount} items swept</span>
                  <span style={{ color: "var(--text-3)" }}>in {d.windowSeconds}s window</span>
                  {d.salePricesJson && d.salePricesJson.length > 0 && (
                    <span style={{ color: "var(--text-3)" }}>@ {minMaxEth(d.salePricesJson)}</span>
                  )}
                  <span className="ml-auto" style={{ color: "var(--text-3)" }}>{timeAgo(d.detectedAt)}</span>
                </div>
              ))}
            </div>
          )}

          {checkResult && (
            <div className={`mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-[12px] ${checkResult.detected ? "border-amber-800/40 bg-amber-950/30 text-amber-300" : "border-graphite-700 bg-graphite-800/50 text-graphite-400"}`}>
              {checkResult.detected ? (
                <><AlertTriangle size={13} className="shrink-0" /><span>Sweep detected — <strong>{checkResult.itemCount} items</strong> in window. {checkResult.salePrices.length > 0 && `@ ${minMaxEth(checkResult.salePrices)}`}</span></>
              ) : (
                <><CheckCircle2 size={13} className="shrink-0 text-status-green-text" /><span>No sweep — <strong>{checkResult.itemCount} sale{checkResult.itemCount !== 1 ? "s" : ""}</strong> in window (threshold: {alert.minItems}).</span></>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="secondary" onClick={runCheck} disabled={checking || deleteMutation.isPending}>
            {checking ? <><Loader2 size={14} className="animate-spin" /> Checking…</> : <><FlaskConical size={14} /> Check now</>}
          </Button>
          <Button variant="secondary" onClick={() => toggleMutation.mutate()} disabled={toggleMutation.isPending}>
            {alert.enabled ? <><ToggleRight size={14} className="text-status-green-text" /> Pause</> : <><ToggleLeft size={14} /> Enable</>}
          </Button>
          <Button variant="secondary" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
            <Trash2 size={14} className="text-status-red-text" />
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-[12px] text-status-red-text">
          <AlertCircle size={13} /> {error}
        </div>
      )}
    </Panel>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SweepAlertsPage() {
  const qc = useQueryClient();

  const { data: alerts = [], isLoading } = useQuery<SweepAlert[]>({
    queryKey: ["sweep-alerts"],
    queryFn: () => apiFetch<SweepAlert[]>("/sweep-alerts"),
    refetchInterval: 30_000,
  });

  const existingSlugs = new Set(alerts.map((a) => a.collectionSlug));
  const activeCount = alerts.filter((a) => a.enabled).length;
  const totalHits = alerts.reduce((sum, a) => sum + a.detections.length, 0);

  function refresh() { qc.invalidateQueries({ queryKey: ["sweep-alerts"] }); }

  return (
    <AppShell title="Sweep Alerts">
      <div className="space-y-5">
        {/* ── Summary bar ── */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="metric-card"><p className="label-caps">Profiles</p><p className="metric-value">{alerts.length}</p></div>
          <div className="metric-card"><p className="label-caps">Active</p><p className="metric-value">{activeCount}</p></div>
          <div className="metric-card"><p className="label-caps">Recent Detections</p><p className="metric-value">{totalHits}</p></div>
        </div>

        {/* ── Import from OpenSea profile ── */}
        <ProfileImportPanel existingSlugs={existingSlugs} onImported={refresh} />

        {/* ── Add single alert ── */}
        <CreateAlertForm onCreated={refresh} />

        {/* ── Alert list ── */}
        {isLoading && (
          <Panel className="p-8 text-center text-sm" style={{ color: "var(--text-3)" }}>
            <Loader2 size={20} className="mx-auto mb-3 animate-spin" />
            Loading alerts…
          </Panel>
        )}

        {!isLoading && alerts.length === 0 && (
          <Panel>
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <div className="grid size-[52px] place-items-center rounded-full" style={{ background: "var(--surface-2)" }}>
                <TrendingDown size={24} style={{ color: "var(--text-3)" }} />
              </div>
              <p className="mt-3 text-[13px] font-medium" style={{ color: "var(--text-2)" }}>No sweep alerts yet</p>
              <p className="mt-1 text-[12px]" style={{ color: "var(--text-3)" }}>
                Import from a profile above or add a collection slug manually.
              </p>
            </div>
          </Panel>
        )}

        {alerts.map((alert) => (
          <AlertCard key={alert.id} alert={alert} onRefresh={refresh} />
        ))}
      </div>
    </AppShell>
  );
}
