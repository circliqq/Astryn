"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  ExternalLink,
  Flame,
  Loader2,
  Puzzle,
  WalletCards,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel, Select } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import {
  buildGasRecommendation,
  DEFAULT_MINT_GAS_UNITS,
  GAS_PRESETS,
  loadSavedGasSettings,
  type GasMode,
  type GasQuote,
  type GasSettings,
  type NetworkKey,
} from "@/lib/gas-settings";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AbiInput {
  name: string;
  type: string;
  components?: AbiInput[];
}

interface AbiFunction {
  name: string;
  type: "function";
  stateMutability: "payable" | "nonpayable";
  inputs: AbiInput[];
}

interface AbiFetchResult {
  contractAddress: string;
  chain: string;
  functions: AbiFunction[];
}

interface Wallet {
  id: string;
  name: string;
  address: string;
  network: "BASE" | "ETHEREUM" | "ROBINHOOD";
  status: string;
}

interface DirectMintTask {
  id: string;
  contractAddress: string;
  functionName: string;
  status: string;
  createdAt: string;
}

type GasModeExtended = GasMode | "advanced";

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortAddr(addr: string) {
  return `${addr.slice(0, 8)}…${addr.slice(-4)}`;
}

function chainToNetwork(chain: "ethereum" | "base" | "robinhood"): "ETHEREUM" | "BASE" | "ROBINHOOD" {
  return chain === "base" ? "BASE" : chain === "robinhood" ? "ROBINHOOD" : "ETHEREUM";
}

function statusColor(status: string) {
  if (status === "COMPLETED") return "green";
  if (status === "FAILED") return "red";
  if (status === "RUNNING") return "blue";
  if (status === "CANCELED") return "slate";
  return "yellow";
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DirectMintPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Step 1 — contract
  const [contractAddress, setContractAddress] = useState("");
  const [chain, setChain] = useState<"ethereum" | "base" | "robinhood">("ethereum");
  const [abiFetchResult, setAbiFetchResult] = useState<AbiFetchResult | null>(null);
  const [abiFetchError, setAbiFetchError] = useState<string | null>(null);
  const [abiFetching, setAbiFetching] = useState(false);

  // Step 2 — function selection
  const [selectedFn, setSelectedFn] = useState<AbiFunction | null>(null);
  const [argValues, setArgValues] = useState<Record<string, string>>({});
  const [valueEth, setValueEth] = useState("0");

  // Step 3 — wallets + gas
  const [selectedWalletIds, setSelectedWalletIds] = useState<string[]>([]);
  const [gasModeExtended, setGasModeExtended] = useState<GasModeExtended>(
    () => loadSavedGasSettings().mode,
  );
  const [advancedGas, setAdvancedGas] = useState({
    maxFeeGwei: 50,
    priorityFeeGwei: 2,
    maxTotalGasCostEth: 0.005,
    maxBumpAttempts: 3,
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mintQuantity, setMintQuantity] = useState("1");
  const [message, setMessage] = useState<string | null>(null);

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: wallets = [] } = useQuery<Wallet[]>({
    queryKey: ["wallets"],
    queryFn: () => apiFetch<Wallet[]>("/wallets"),
  });

  const { data: gasQuote } = useQuery<GasQuote>({
    queryKey: ["gas-current", chain],
    queryFn: () => apiFetch<GasQuote>(`/gas/current?network=${chain}`),
    refetchInterval: 15_000,
    enabled: Boolean(abiFetchResult),
  });

  const { data: recentTasks = [], refetch: refetchTasks } = useQuery<DirectMintTask[]>({
    queryKey: ["direct-mint-tasks"],
    queryFn: () => apiFetch<DirectMintTask[]>("/direct-mint/tasks"),
  });

  // ── Derived ───────────────────────────────────────────────────────────────

  const compatibleWallets = useMemo(
    () => wallets.filter((w) => w.network === chainToNetwork(chain)),
    [wallets, chain],
  );

  const gasMode: GasMode = gasModeExtended === "advanced" ? "balanced" : gasModeExtended;

  const gasRec = useMemo(() => {
    if (!gasQuote) return null;
    return buildGasRecommendation({
      gas: gasQuote,
      network: chain as NetworkKey,
      mode: gasMode,
      estimatedGasUnits: DEFAULT_MINT_GAS_UNITS,
      walletCount: Math.max(1, selectedWalletIds.length),
    });
  }, [gasQuote, chain, gasMode, selectedWalletIds.length]);

  const effectiveGasSettings: GasSettings =
    gasModeExtended === "advanced"
      ? {
          mode: "balanced",
          maxFeeGwei: advancedGas.maxFeeGwei,
          priorityFeeGwei: advancedGas.priorityFeeGwei,
          maxTotalGasCostEth: advancedGas.maxTotalGasCostEth,
          gasBumpEnabled: true,
          maxBumpAttempts: advancedGas.maxBumpAttempts,
        }
      : GAS_PRESETS[gasMode];

  const isPayable = selectedFn?.stateMutability === "payable";
  const canCreate =
    Boolean(abiFetchResult) &&
    Boolean(selectedFn) &&
    selectedWalletIds.length > 0;

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleFetchAbi() {
    const addr = contractAddress.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      setAbiFetchError("Enter a valid contract address (0x + 40 hex chars).");
      return;
    }
    setAbiFetching(true);
    setAbiFetchError(null);
    setAbiFetchResult(null);
    setSelectedFn(null);
    setArgValues({});
    try {
      const result = await apiFetch<AbiFetchResult>("/direct-mint/fetch-abi", {
        method: "POST",
        body: JSON.stringify({ contractAddress: addr, chain }),
      });
      setAbiFetchResult(result);
    } catch (err) {
      setAbiFetchError(err instanceof Error ? err.message : "ABI fetch failed.");
    } finally {
      setAbiFetching(false);
    }
  }

  function selectFunction(fn: AbiFunction) {
    setSelectedFn(fn);
    setArgValues({});
  }

  function toggleWallet(id: string) {
    setSelectedWalletIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const createTask = useMutation({
    mutationFn: () => {
      if (!abiFetchResult || !selectedFn) throw new Error("Missing required data.");
      const args = (selectedFn.inputs ?? []).map((inp) => argValues[inp.name] ?? "");
      return apiFetch<DirectMintTask>("/direct-mint/tasks", {
        method: "POST",
        body: JSON.stringify({
          contractAddress: abiFetchResult.contractAddress,
          chain: chainToNetwork(chain),
          functionName: selectedFn.name,
          functionAbi: selectedFn,
          callArgs: args,
          valueWei: isPayable
            ? String(BigInt(Math.round(Number(valueEth || "0") * 1e18)))
            : "0",
          walletIds: selectedWalletIds,
          gasSettings: effectiveGasSettings,
          mintQuantity: Math.max(1, Number.parseInt(mintQuantity, 10) || 1),
        }),
      });
    },
    onSuccess: (task) => {
      setMessage(`Task created (${task.id.slice(0, 8)}…). Running now…`);
      void runTask.mutateAsync(task.id);
    },
    onError: (err) =>
      setMessage(err instanceof Error ? err.message : "Failed to create task."),
  });

  const runTask = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean }>(`/direct-mint/tasks/${id}/run`, { method: "POST" }),
    onSuccess: () => {
      setMessage("Task queued — wallets are minting now.");
      void refetchTasks();
      void queryClient.invalidateQueries({ queryKey: ["direct-mint-tasks"] });
    },
    onError: (err) =>
      setMessage(err instanceof Error ? err.message : "Failed to queue task."),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canCreate) { setMessage("Fill in all required fields."); return; }
    createTask.mutate();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppShell title="Direct Contract Mint">
      <form className="space-y-5" onSubmit={handleSubmit}>
        {/* Summary bar */}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="metric-card">
            <p className="label-caps">Contract</p>
            <p className="metric-value text-[18px]">{abiFetchResult ? "Loaded" : "None"}</p>
          </div>
          <div className="metric-card">
            <p className="label-caps">Function</p>
            <p className="metric-value text-[18px] truncate">{selectedFn?.name ?? "—"}</p>
          </div>
          <div className="metric-card">
            <p className="label-caps">Wallets</p>
            <p className="metric-value">{selectedWalletIds.length}</p>
          </div>
          <div className="metric-card">
            <p className="label-caps">Chain</p>
            <p className="metric-value text-[18px] capitalize">{chain}</p>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <div className="space-y-5">

            {/* ── Step 1: Contract + ABI ─────────────────────────────────── */}
            <Panel>
              <div className="panel-header">
                <div>
                  <p className="text-[14px] font-semibold text-graphite-100">
                    Step 1 — Contract Address
                  </p>
                  <p className="mt-0.5 text-[12px] text-graphite-500">
                    Paste any verified NFT contract — ABI is fetched from Etherscan / Basescan.
                  </p>
                </div>
                <Puzzle size={17} className="text-graphite-500" />
              </div>
              <div className="p-5 space-y-4">
                <div className="flex flex-col gap-3 md:flex-row">
                  <Input
                    className="flex-1 font-mono"
                    value={contractAddress}
                    onChange={(e) => setContractAddress(e.target.value)}
                    placeholder="0x460d7dfa7aefb52ddb7b87a767485325b31272d9"
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleFetchAbi())}
                  />
                  <select
                    value={chain}
                    onChange={(e) => setChain(e.target.value as "ethereum" | "base" | "robinhood")}
                    className="rounded-md border border-graphite-700 bg-graphite-800 px-3 py-2 text-[13px] text-graphite-100 focus:border-brand focus:outline-none"
                  >
                    <option value="ethereum">Ethereum</option>
                    <option value="base">Base</option>
                    <option value="robinhood">Robinhood</option>
                  </select>
                  <Button
                    type="button"
                    onClick={handleFetchAbi}
                    disabled={abiFetching || !contractAddress.trim()}
                  >
                    {abiFetching ? (
                      <span className="flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Fetching…</span>
                    ) : "Load ABI"}
                  </Button>
                </div>
                {abiFetchError && (
                  <p className="rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-[12px] text-status-red-text">
                    {abiFetchError}
                  </p>
                )}
                {abiFetchResult && (
                  <div className="flex items-center gap-2 text-[12px] text-status-green-text">
                    <CheckCircle2 size={13} />
                    ABI loaded — {abiFetchResult.functions.length} write function{abiFetchResult.functions.length !== 1 ? "s" : ""} found.
                  </div>
                )}
              </div>
            </Panel>

            {/* ── Step 2: Function picker ────────────────────────────────── */}
            {abiFetchResult && (
              <Panel>
                <div className="panel-header">
                  <div>
                    <p className="text-[14px] font-semibold text-graphite-100">
                      Step 2 — Select Mint Function
                    </p>
                    <p className="mt-0.5 text-[12px] text-graphite-500">
                      Pick the function to call for each wallet.
                    </p>
                  </div>
                  <Code2 size={17} className="text-graphite-500" />
                </div>
                <div className="p-5 space-y-3">
                  <div className="grid gap-2 md:grid-cols-2">
                    {abiFetchResult.functions.map((fn) => {
                      const isSelected = selectedFn?.name === fn.name;
                      return (
                        <button
                          key={fn.name}
                          type="button"
                          onClick={() => selectFunction(fn)}
                          className={`rounded-md border px-3 py-2.5 text-left transition-colors ${
                            isSelected
                              ? "border-brand bg-brand-bg"
                              : "border-graphite-700 bg-graphite-800 hover:border-graphite-600"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[13px] font-medium text-graphite-100">
                              {fn.name}
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {fn.stateMutability === "payable" && (
                                <Badge tone="yellow">payable</Badge>
                              )}
                              {isSelected && <ChevronRight size={13} className="text-brand" />}
                            </div>
                          </div>
                          {fn.inputs.length > 0 && (
                            <p className="mt-1 font-mono text-[10px] text-graphite-500">
                              ({fn.inputs.map((i) => `${i.type} ${i.name}`).join(", ")})
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Argument inputs */}
                  {selectedFn && (selectedFn.inputs.length > 0 || isPayable) && (
                    <div className="rounded-md border border-graphite-700 bg-graphite-800/60 p-4 space-y-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-graphite-400">
                        Parameters for <span className="font-mono text-brand">{selectedFn.name}</span>
                      </p>
                      {selectedFn.inputs.map((inp) => (
                        <label key={inp.name}>
                          <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                            <span className="font-mono text-brand">{inp.name}</span>
                            <span className="ml-1.5 text-graphite-500">({inp.type})</span>
                          </span>
                          <Input
                            value={argValues[inp.name] ?? ""}
                            onChange={(e) =>
                              setArgValues((prev) => ({ ...prev, [inp.name]: e.target.value }))
                            }
                            placeholder={
                              inp.type === "address"
                                ? "0x…"
                                : inp.type.startsWith("uint") || inp.type.startsWith("int")
                                ? "0"
                                : inp.type === "bool"
                                ? "true / false"
                                : ""
                            }
                          />
                        </label>
                      ))}
                      {isPayable && (
                        <label>
                          <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                            ETH to send (value)
                          </span>
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            value={valueEth}
                            onChange={(e) => setValueEth(e.target.value)}
                            placeholder="0.00"
                          />
                        </label>
                      )}
                    </div>
                  )}
                </div>
              </Panel>
            )}

            {/* ── Step 3: Wallet selection ───────────────────────────────── */}
            {abiFetchResult && (
              <Panel>
                <div className="panel-header">
                  <div>
                    <p className="text-[14px] font-semibold text-graphite-100">
                      Step 3 — Select Wallets
                    </p>
                    <p className="mt-0.5 text-[12px] text-graphite-500">
                      Each selected wallet calls the function once per run.
                    </p>
                  </div>
                  <WalletCards size={17} className="text-graphite-500" />
                </div>
                <div className="grid gap-2 p-5 md:grid-cols-2 xl:grid-cols-3">
                  {compatibleWallets.length === 0 ? (
                    <p className="notice md:col-span-2 xl:col-span-3">
                      No {chain === "base" ? "Base" : chain === "robinhood" ? "Robinhood" : "Ethereum"} wallets found.
                    </p>
                  ) : (
                    compatibleWallets.map((wallet) => {
                      const selected = selectedWalletIds.includes(wallet.id);
                      return (
                        <button
                          key={wallet.id}
                          type="button"
                          onClick={() => toggleWallet(wallet.id)}
                          className={`rounded-md border px-3 py-3 text-left transition-colors ${
                            selected
                              ? "border-brand bg-brand-bg"
                              : "border-graphite-700 bg-graphite-800 hover:border-graphite-600"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium text-graphite-100">
                              {wallet.name}
                            </span>
                            <Badge tone={selected ? "green" : "slate"}>
                              {selected ? "Selected" : wallet.status}
                            </Badge>
                          </div>
                          <p className="mt-1 font-mono text-[11px] text-graphite-500">
                            {shortAddr(wallet.address)}
                          </p>
                        </button>
                      );
                    })
                  )}
                </div>
              </Panel>
            )}
          </div>

          {/* ── Right column ──────────────────────────────────────────────── */}
          {abiFetchResult && (
            <div className="space-y-5">
              {/* Gas + execution */}
              <Panel>
                <div className="panel-header">
                  <p className="text-[14px] font-semibold text-graphite-100">Execution</p>
                </div>
                <div className="space-y-4 p-5">
                  {/* Quantity */}
                  <label>
                    <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                      Call count per wallet
                    </span>
                    <Input
                      type="number"
                      min="1"
                      max="50"
                      value={mintQuantity}
                      onChange={(e) => setMintQuantity(e.target.value)}
                    />
                  </label>

                  {/* Gas mode */}
                  <div>
                    <label>
                      <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                        Gas mode
                      </span>
                      <Select
                        value={gasModeExtended}
                        onChange={(e) => {
                          const val = e.target.value as GasModeExtended;
                          setGasModeExtended(val);
                          if (val === "advanced") setAdvancedOpen(true);
                        }}
                      >
                        <option value="safe">Safe</option>
                        <option value="balanced">Balanced</option>
                        <option value="aggressive">Aggressive</option>
                        <option value="advanced">Advanced (Custom)</option>
                      </Select>
                    </label>

                    {gasModeExtended === "advanced" && (
                      <div className="mt-3 rounded-md border border-graphite-700 bg-graphite-800/60">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-2 text-[12px] font-medium text-graphite-300 hover:text-graphite-100"
                          onClick={() => setAdvancedOpen((o) => !o)}
                        >
                          <span className="flex items-center gap-1.5">
                            <Zap size={12} className="text-brand" /> Custom gas
                          </span>
                          <ChevronDown size={13} className={advancedOpen ? "rotate-180" : ""} />
                        </button>
                        {advancedOpen && (
                          <div className="grid gap-3 border-t border-graphite-700 px-3 pb-3 pt-3 md:grid-cols-2">
                            {[
                              { label: "Max fee (gwei)", key: "maxFeeGwei", min: 1 },
                              { label: "Priority fee (gwei)", key: "priorityFeeGwei", min: 0 },
                              { label: "Gas cap (ETH)", key: "maxTotalGasCostEth", min: 0 },
                              { label: "Max bump attempts", key: "maxBumpAttempts", min: 0, max: 10 },
                            ].map(({ label, key, min, max }) => (
                              <label key={key}>
                                <span className="mb-1 block text-[10px] font-medium text-graphite-400">
                                  {label}
                                </span>
                                <Input
                                  type="number"
                                  min={min}
                                  max={max}
                                  step="any"
                                  value={(advancedGas as Record<string, number>)[key]}
                                  onChange={(e) =>
                                    setAdvancedGas((g) => ({
                                      ...g,
                                      [key]: Number(e.target.value),
                                    }))
                                  }
                                />
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Gas estimate */}
                  <div className="rounded-md border border-graphite-700 bg-graphite-800/50 px-3 py-3 text-[12px]">
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-graphite-400">
                      <Flame size={12} className="text-orange-400" />
                      Gas Estimate
                    </div>
                    {!gasQuote ? (
                      <p className="text-graphite-500">Fetching live gas…</p>
                    ) : gasRec ? (
                      <div className="space-y-1.5 text-graphite-300">
                        <div className="flex justify-between">
                          <span className="text-graphite-400">Max fee</span>
                          <span className="font-mono">{gasRec.settings.maxFeeGwei} gwei</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-graphite-400">Priority</span>
                          <span className="font-mono">{gasRec.settings.priorityFeeGwei} gwei</span>
                        </div>
                        <div className="my-1 border-t border-graphite-700" />
                        <div className="flex justify-between font-medium text-graphite-100">
                          <span>Est. cost / wallet</span>
                          <span className="font-mono text-orange-300">
                            ~{gasRec.estimatedGasCostEth.toFixed(5)} ETH
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-graphite-500">Unable to estimate.</p>
                    )}
                  </div>
                </div>
              </Panel>

              {/* Readiness + submit */}
              <Panel>
                <div className="panel-header">
                  <p className="text-[14px] font-semibold text-graphite-100">Readiness</p>
                  <Badge tone={canCreate ? "green" : "yellow"}>
                    {canCreate ? "Ready" : "Needs input"}
                  </Badge>
                </div>
                <div className="space-y-3 p-5 text-[13px] text-graphite-400">
                  {[
                    { ok: Boolean(abiFetchResult), label: "Contract ABI loaded" },
                    { ok: Boolean(selectedFn), label: "Function selected" },
                    { ok: selectedWalletIds.length > 0, label: "At least one wallet" },
                  ].map(({ ok, label }) => (
                    <p key={label} className="flex items-center gap-2">
                      <CheckCircle2
                        size={14}
                        className={ok ? "text-status-green-text" : "text-graphite-600"}
                      />
                      {label}
                    </p>
                  ))}

                  {selectedFn && (
                    <div className="rounded-md border border-graphite-700 bg-graphite-800/50 px-3 py-2.5 text-[12px]">
                      <p className="font-mono text-graphite-300">
                        <span className="text-brand">{selectedFn.name}</span>
                        {"("}
                        {selectedFn.inputs.map((i, idx) => (
                          <span key={i.name}>
                            {idx > 0 && ", "}
                            <span className="text-graphite-500">{i.type}</span>
                            {" "}
                            <span className="text-graphite-100">
                              {argValues[i.name] ? `"${argValues[i.name]}"` : i.name}
                            </span>
                          </span>
                        ))}
                        {")"}
                      </p>
                      {isPayable && Number(valueEth) > 0 && (
                        <p className="mt-1 font-mono text-[11px] text-yellow-400">
                          value: {valueEth} ETH
                        </p>
                      )}
                    </div>
                  )}

                  {message && (
                    <p className="notice text-[12px]">{message}</p>
                  )}

                  <Button
                    className="w-full"
                    disabled={!canCreate || createTask.isPending || runTask.isPending}
                  >
                    {createTask.isPending || runTask.isPending
                      ? "Minting…"
                      : `Mint Now (${selectedWalletIds.length} wallet${selectedWalletIds.length !== 1 ? "s" : ""})`}
                  </Button>
                </div>
              </Panel>
            </div>
          )}
        </div>

        {/* ── Recent direct-mint tasks ──────────────────────────────────────── */}
        {recentTasks.length > 0 && (
          <Panel>
            <div className="panel-header">
              <p className="text-[14px] font-semibold text-graphite-100">Recent Tasks</p>
            </div>
            <div className="divide-y divide-graphite-700">
              {recentTasks.slice(0, 10).map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between gap-4 px-5 py-3 text-[13px]"
                >
                  <div className="min-w-0">
                    <p className="font-mono font-medium text-graphite-100 truncate">
                      {task.functionName}
                    </p>
                    <p className="font-mono text-[11px] text-graphite-500 truncate">
                      {shortAddr(task.contractAddress)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Badge tone={statusColor(task.status) as "green" | "red" | "blue" | "yellow" | "slate"}>
                      {task.status}
                    </Badge>
                    <button
                      type="button"
                      onClick={() => router.push(`/direct-mint/${task.id}`)}
                      className="text-graphite-500 hover:text-graphite-200"
                    >
                      <ExternalLink size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </form>
    </AppShell>
  );
}
