"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Layers,
  Loader2,
  Play,
  Plus,
  Trash2,
  Vault,
  Wallet,
  XCircle,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel, Select } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface WalletItem {
  id: string;
  name: string;
  address: string;
  network: "BASE" | "ETHEREUM" | "ROBINHOOD";
}

interface WalletNftCollection {
  slug: string;
  name: string;
  imageUrl: string | null;
  count: number;
}

interface ConsolidationRule {
  id: string;
  name: string;
  coldWallet: string;
  network: "BASE" | "ETHEREUM" | "ROBINHOOD";
  sourceWalletIds: string[];
  contractAddresses: string[];
  autoTrigger: boolean;
  enabled: boolean;
  createdAt: string;
  lastJob?: { status: string; transferCount: number; createdAt: string } | null;
}

interface ConsolidationJob {
  id: string;
  ruleName: string;
  status: string;
  triggeredBy: string;
  transferCount: number;
  createdAt: string;
  completedAt: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const JOB_TONE: Record<string, "green" | "blue" | "yellow" | "red" | "slate"> = {
  completed: "green",
  running:   "blue",
  partial:   "yellow",
  failed:    "red",
};

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

// ── NFT preview inside wallet card ───────────────────────────────────────────

function WalletNftPreview({ address, network }: { address: string; network: "BASE" | "ETHEREUM" | "ROBINHOOD" }) {
  const { data, isLoading } = useQuery<WalletNftCollection[]>({
    queryKey: ["wallet-nfts", address, network],
    queryFn: () =>
      apiFetch<WalletNftCollection[]>(
        `/consolidation/wallet-nfts?address=${encodeURIComponent(address)}&network=${network}`,
      ),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading)
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-graphite-500">
        <Loader2 size={11} className="animate-spin" /> Fetching NFTs…
      </div>
    );

  if (!data || data.length === 0)
    return <p className="px-3 py-2 text-[11px] text-graphite-500">No NFTs on this network.</p>;

  return (
    <div className="max-h-32 overflow-y-auto divide-y divide-graphite-700/50">
      {data.map((col) => (
        <div key={col.slug} className="flex items-center gap-2 px-3 py-1.5">
          {col.imageUrl ? (
            <img src={col.imageUrl} alt={col.name} className="size-5 rounded shrink-0 object-cover" />
          ) : (
            <div className="size-5 rounded bg-graphite-700 shrink-0" />
          )}
          <span className="flex-1 truncate text-[11px] text-graphite-200">{col.name}</span>
          <span className="text-[10px] font-medium text-graphite-400 shrink-0">{col.count} NFT{col.count !== 1 ? "s" : ""}</span>
        </div>
      ))}
    </div>
  );
}

// ── Step label ────────────────────────────────────────────────────────────────

function Step({ n, label, done }: { n: number; label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold",
        done ? "bg-brand text-white" : "bg-graphite-700 text-graphite-400",
      )}>
        {done ? <CheckCircle2 size={13} /> : n}
      </div>
      <span className={cn("text-[12px] font-medium", done ? "text-brand" : "text-graphite-400")}>{label}</span>
    </div>
  );
}

// ── Rule card ─────────────────────────────────────────────────────────────────

function RuleCard({
  rule,
  allWallets,
  onRun,
  onDelete,
  running,
}: {
  rule: ConsolidationRule;
  allWallets: WalletItem[];
  onRun: () => void;
  onDelete: () => void;
  running: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const sourceNames = rule.sourceWalletIds
    .map((id) => allWallets.find((w) => w.id === id)?.name ?? shortAddr(id))
    .join(", ");

  return (
    <div className="rounded-lg border border-graphite-700 bg-graphite-900">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-graphite-100">{rule.name}</span>
            <Badge tone="blue">{rule.network === "ETHEREUM" ? "Ethereum" : rule.network === "ROBINHOOD" ? "Robinhood" : "Base"}</Badge>
            <Badge tone={rule.enabled ? "green" : "slate"}>{rule.enabled ? "Active" : "Paused"}</Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-graphite-500 truncate">
            {rule.sourceWalletIds.length} source wallet{rule.sourceWalletIds.length !== 1 ? "s" : ""} → <span className="font-mono">{shortAddr(rule.coldWallet)}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={onRun}
            disabled={!rule.enabled || running}
            title="Run consolidation now"
          >
            {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            Run now
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)} title="Show details">
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} title="Delete rule">
            <Trash2 size={13} className="text-status-red-text" />
          </Button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-graphite-700 px-4 py-3 space-y-3">
          {/* Visual flow */}
          <div className="flex items-center gap-2 rounded-md bg-graphite-800 px-3 py-2">
            <div className="flex flex-wrap gap-1">
              {rule.sourceWalletIds.map((id) => {
                const w = allWallets.find((ww) => ww.id === id);
                return (
                  <span key={id} className="rounded bg-graphite-700 px-2 py-0.5 text-[11px] font-medium text-graphite-200">
                    {w?.name ?? shortAddr(id)}
                  </span>
                );
              })}
            </div>
            <ArrowRight size={14} className="shrink-0 text-graphite-500" />
            <div className="flex items-center gap-1.5 rounded bg-brand/10 border border-brand/30 px-2 py-0.5">
              <Vault size={12} className="text-brand" />
              <span className="font-mono text-[11px] text-brand">{shortAddr(rule.coldWallet)}</span>
            </div>
          </div>

          <div className="grid gap-2 text-[12px] sm:grid-cols-2">
            <div>
              <p className="text-graphite-500">Source wallets</p>
              <p className="text-graphite-200">{sourceNames || "—"}</p>
            </div>
            <div>
              <p className="text-graphite-500">Contract filter</p>
              <p className="text-graphite-200">{rule.contractAddresses.length > 0 ? `${rule.contractAddresses.length} contract(s)` : "All NFTs"}</p>
            </div>
            <div>
              <p className="text-graphite-500">Auto-trigger on mint</p>
              <p className="text-graphite-200">{rule.autoTrigger ? "Yes" : "No"}</p>
            </div>
            {rule.lastJob && (
              <div>
                <p className="text-graphite-500">Last run</p>
                <p className="text-graphite-200">
                  <Badge tone={JOB_TONE[rule.lastJob.status] ?? "slate"}>{rule.lastJob.status}</Badge>
                  {" "}{rule.lastJob.transferCount} transfer{rule.lastJob.transferCount !== 1 ? "s" : ""}
                  {" · "}{timeAgo(rule.lastJob.createdAt)}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ConsolidationPage() {
  const queryClient = useQueryClient();

  // Form state
  const [name, setName] = useState("");
  const [coldWallet, setColdWallet] = useState("");
  const [network, setNetwork] = useState<"BASE" | "ETHEREUM" | "ROBINHOOD">("ETHEREUM");
  const [selectedWalletIds, setSelectedWalletIds] = useState<string[]>([]);
  const [expandedWalletId, setExpandedWalletId] = useState<string | null>(null);
  const [contracts, setContracts] = useState("");
  const [autoTrigger, setAutoTrigger] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [runningRuleId, setRunningRuleId] = useState<string | null>(null);

  const { data: wallets = [] } = useQuery<WalletItem[]>({
    queryKey: ["wallets"],
    queryFn: () => apiFetch<WalletItem[]>("/wallets"),
  });

  const { data: rules = [], isLoading: rulesLoading } = useQuery<ConsolidationRule[]>({
    queryKey: ["consolidation-rules"],
    queryFn: () => apiFetch<ConsolidationRule[]>("/consolidation/rules"),
  });

  const { data: jobs = [] } = useQuery<ConsolidationJob[]>({
    queryKey: ["consolidation-jobs"],
    queryFn: () => apiFetch<ConsolidationJob[]>("/consolidation/jobs"),
    refetchInterval: 15_000,
  });

  const networkWallets = wallets.filter((w) => w.network === network);

  // Steps completion
  const step1Done = name.trim().length > 0 && coldWallet.trim().length > 0;
  const step2Done = selectedWalletIds.length > 0;
  const step3Done = step1Done && step2Done;

  const createRule = useMutation({
    mutationFn: () =>
      apiFetch<ConsolidationRule>("/consolidation/rules", {
        method: "POST",
        body: JSON.stringify({
          name,
          coldWallet,
          network,
          sourceWalletIds: selectedWalletIds,
          contractAddresses: contracts.split(/[\s,]+/).map((a) => a.trim()).filter(Boolean),
          autoTrigger,
        }),
      }),
    onSuccess: () => {
      setName(""); setColdWallet(""); setContracts(""); setSelectedWalletIds([]); setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["consolidation-rules"] });
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : "Failed to create rule."),
  });

  async function handleRun(ruleId: string) {
    setRunningRuleId(ruleId);
    try {
      await apiFetch(`/consolidation/rules/${ruleId}/run`, { method: "POST" });
      queryClient.invalidateQueries({ queryKey: ["consolidation-rules"] });
      queryClient.invalidateQueries({ queryKey: ["consolidation-jobs"] });
    } finally {
      setRunningRuleId(null);
    }
  }

  const deleteRule = useMutation({
    mutationFn: (id: string) => apiFetch(`/consolidation/rules/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["consolidation-rules"] }),
  });

  function toggleWallet(id: string) {
    setSelectedWalletIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!coldWallet.trim().startsWith("0x")) { setFormError("Enter a valid 0x cold wallet address."); return; }
    if (selectedWalletIds.length === 0) { setFormError("Select at least one source wallet."); return; }
    setFormError(null);
    createRule.mutate();
  }

  return (
    <AppShell title="Auto-Consolidation">
      <div className="space-y-5">

        {/* ── How it works banner ───────────────────────────────────── */}
        <div className="rounded-lg border border-graphite-700 bg-graphite-900 px-5 py-4">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-graphite-500">How it works</p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-md bg-graphite-800 px-3 py-2">
              <Wallet size={14} className="text-graphite-400" />
              <span className="text-[12px] text-graphite-200">Hot wallets hold minted NFTs</span>
            </div>
            <ArrowRight size={14} className="text-graphite-600 shrink-0" />
            <div className="flex items-center gap-2 rounded-md bg-graphite-800 px-3 py-2">
              <Zap size={14} className="text-brand" />
              <span className="text-[12px] text-graphite-200">Rule triggers automatically or manually</span>
            </div>
            <ArrowRight size={14} className="text-graphite-600 shrink-0" />
            <div className="flex items-center gap-2 rounded-md bg-brand/10 border border-brand/30 px-3 py-2">
              <Vault size={14} className="text-brand" />
              <span className="text-[12px] text-brand font-medium">NFTs move to your cold wallet</span>
            </div>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[440px_1fr]">

          {/* ── Create rule form ──────────────────────────────────────── */}
          <Panel>
            <div className="panel-header">
              <div>
                <p className="text-[14px] font-semibold text-graphite-100">New Consolidation Rule</p>
                <p className="mt-0.5 text-[12px] text-graphite-500">Set up automatic NFT sweeping in 3 steps.</p>
              </div>
            </div>

            <form className="p-5 space-y-6" onSubmit={handleSubmit}>

              {/* Step 1 */}
              <div className="space-y-3">
                <Step n={1} label="Name this rule & set destination" done={step1Done} />
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">Rule name</span>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Post-mint sweep to cold"
                    required
                  />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">Network</span>
                  <Select value={network} onChange={(e) => { setNetwork(e.target.value as "BASE" | "ETHEREUM" | "ROBINHOOD"); setSelectedWalletIds([]); }}>
                    <option value="ETHEREUM">Ethereum</option>
                    <option value="BASE">Base</option>
                    <option value="ROBINHOOD">Robinhood</option>
                  </Select>
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                    Cold wallet address <span className="text-graphite-600">(destination — NFTs go here)</span>
                  </span>
                  <Input
                    value={coldWallet}
                    onChange={(e) => setColdWallet(e.target.value)}
                    placeholder="0x…"
                    required
                  />
                </label>
              </div>

              {/* Step 2 */}
              <div className="space-y-3">
                <Step n={2} label="Choose source wallets to sweep from" done={step2Done} />
                {networkWallets.length === 0 ? (
                  <p className="notice text-[12px]">No wallets on {network === "ETHEREUM" ? "Ethereum" : network === "ROBINHOOD" ? "Robinhood" : "Base"}. Add wallets first.</p>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {networkWallets.map((wallet) => {
                      const selected = selectedWalletIds.includes(wallet.id);
                      const expanded = expandedWalletId === wallet.id;
                      return (
                        <div
                          key={wallet.id}
                          className={cn(
                            "rounded-md border transition-colors",
                            selected ? "border-brand bg-brand-bg" : "border-graphite-700 bg-graphite-800",
                          )}
                        >
                          <div className="flex items-center gap-2 px-3 py-2">
                            <button
                              type="button"
                              className="flex flex-1 items-center gap-2 text-left min-w-0"
                              onClick={() => toggleWallet(wallet.id)}
                            >
                              <div className={cn("size-3.5 shrink-0 rounded-sm border-2 transition-colors", selected ? "border-brand bg-brand" : "border-graphite-600")} />
                              <div className="min-w-0">
                                <p className="text-[13px] font-medium text-graphite-100 truncate">{wallet.name}</p>
                                <p className="text-[10px] font-mono text-graphite-500 truncate">{shortAddr(wallet.address)}</p>
                              </div>
                            </button>
                            <Badge tone={selected ? "green" : "slate"}>{selected ? "Selected" : "Tap to select"}</Badge>
                            <button
                              type="button"
                              title="Preview NFTs in this wallet"
                              className="ml-1 shrink-0 text-graphite-500 hover:text-graphite-200"
                              onClick={() => setExpandedWalletId(expanded ? null : wallet.id)}
                            >
                              <Layers size={13} />
                            </button>
                          </div>
                          {expanded && (
                            <div className="border-t border-graphite-700/60">
                              <WalletNftPreview address={wallet.address} network={network} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Step 3 */}
              <div className="space-y-3">
                <Step n={3} label="Optional filters & trigger" done={false} />
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                    Contract addresses <span className="text-graphite-600">(leave blank = move ALL NFTs)</span>
                  </span>
                  <textarea
                    className="min-h-[72px] w-full rounded-md border border-graphite-700 bg-graphite-800 px-3 py-2 text-[12px] text-graphite-100 outline-none focus:border-brand focus:shadow-focus-brand"
                    value={contracts}
                    onChange={(e) => setContracts(e.target.value)}
                    placeholder="0xABC… 0xDEF…   (one per line or space-separated)"
                  />
                </label>
                <label className="flex cursor-pointer items-center justify-between rounded-md border border-graphite-700 bg-graphite-800 px-3 py-2.5">
                  <div>
                    <p className="text-[13px] font-medium text-graphite-200">Auto-trigger after mint</p>
                    <p className="text-[11px] text-graphite-500">Run immediately when a mint task completes</p>
                  </div>
                  <input
                    type="checkbox"
                    className="accent-brand scale-125"
                    checked={autoTrigger}
                    onChange={(e) => setAutoTrigger(e.target.checked)}
                  />
                </label>
              </div>

              {/* Summary preview */}
              {step3Done && (
                <div className="rounded-md border border-graphite-700 bg-graphite-800/50 px-3 py-2.5 text-[12px] space-y-1">
                  <p className="font-medium text-graphite-300">Ready to create:</p>
                  <div className="flex items-center gap-2 text-graphite-400">
                    <span>{selectedWalletIds.length} wallet{selectedWalletIds.length !== 1 ? "s" : ""}</span>
                    <ArrowRight size={11} />
                    <span className="font-mono">{shortAddr(coldWallet)}</span>
                    {autoTrigger && <Badge tone="blue">Auto</Badge>}
                  </div>
                </div>
              )}

              {formError && (
                <div className="flex items-center gap-2 rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-[12px] text-status-red-text">
                  <AlertCircle size={13} /> {formError}
                </div>
              )}

              <Button className="w-full" disabled={createRule.isPending || !step3Done}>
                {createRule.isPending
                  ? <><Loader2 size={14} className="animate-spin" /> Creating…</>
                  : <><Plus size={14} /> Create Consolidation Rule</>}
              </Button>
            </form>
          </Panel>

          {/* ── Right column ─────────────────────────────────────────── */}
          <div className="space-y-5">

            {/* Stats */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="metric-card">
                <p className="label-caps">Rules</p>
                <p className="metric-value">{rules.length}</p>
                <p className="mt-1 text-[11px] text-graphite-500">{rules.filter((r) => r.enabled).length} active</p>
              </div>
              <div className="metric-card">
                <p className="label-caps">Jobs run</p>
                <p className="metric-value">{jobs.length}</p>
                <p className="mt-1 text-[11px] text-graphite-500">{jobs.filter((j) => j.status === "completed").length} completed</p>
              </div>
              <div className="metric-card">
                <p className="label-caps">NFTs moved</p>
                <p className="metric-value">{jobs.reduce((s, j) => s + j.transferCount, 0)}</p>
                <p className="mt-1 text-[11px] text-graphite-500">total transfers</p>
              </div>
            </div>

            {/* Rules */}
            <Panel>
              <div className="panel-header">
                <div>
                  <p className="text-[14px] font-semibold text-graphite-100">Your Rules</p>
                  <p className="mt-0.5 text-[12px] text-graphite-500">Click "Run now" to sweep immediately, or wait for auto-trigger.</p>
                </div>
                <Badge tone="neutral">{rules.length}</Badge>
              </div>
              {rulesLoading ? (
                <div className="flex items-center justify-center gap-2 p-8 text-[13px] text-graphite-400">
                  <Loader2 size={16} className="animate-spin" /> Loading…
                </div>
              ) : rules.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-center">
                  <Vault size={28} className="mb-3 text-graphite-600" />
                  <p className="text-[13px] font-medium text-graphite-300">No rules yet</p>
                  <p className="mt-1 text-[12px] text-graphite-500">Create your first rule using the form on the left.</p>
                </div>
              ) : (
                <div className="space-y-2 p-4">
                  {rules.map((rule) => (
                    <RuleCard
                      key={rule.id}
                      rule={rule}
                      allWallets={wallets}
                      onRun={() => handleRun(rule.id)}
                      onDelete={() => deleteRule.mutate(rule.id)}
                      running={runningRuleId === rule.id}
                    />
                  ))}
                </div>
              )}
            </Panel>

            {/* Job history */}
            <Panel>
              <div className="panel-header">
                <div>
                  <p className="text-[14px] font-semibold text-graphite-100">Job History</p>
                  <p className="mt-0.5 text-[12px] text-graphite-500">Every consolidation run and its result.</p>
                </div>
                <Badge tone="neutral">{jobs.length}</Badge>
              </div>
              {jobs.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-center">
                  <Clock size={22} className="mb-2 text-graphite-600" />
                  <p className="text-[12px] text-graphite-500">No jobs run yet. Hit "Run now" on a rule to start.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table w-full min-w-[560px] text-left">
                    <thead>
                      <tr>
                        <th>Rule</th>
                        <th>Trigger</th>
                        <th>Status</th>
                        <th>Transfers</th>
                        <th>When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((job) => (
                        <tr key={job.id}>
                          <td className="font-medium text-graphite-200">{job.ruleName}</td>
                          <td className="capitalize text-graphite-400">{job.triggeredBy}</td>
                          <td>
                            <div className="flex items-center gap-1">
                              {job.status === "completed" && <CheckCircle2 size={12} className="text-status-green-text" />}
                              {job.status === "failed"    && <XCircle     size={12} className="text-status-red-text" />}
                              {job.status === "running"   && <Loader2     size={12} className="animate-spin text-blue-400" />}
                              <Badge tone={JOB_TONE[job.status] ?? "slate"}>{job.status}</Badge>
                            </div>
                          </td>
                          <td className="font-medium">{job.transferCount}</td>
                          <td className="text-[12px] text-graphite-500">{timeAgo(job.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
