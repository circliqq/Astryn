"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Flame,
  Layers,
  Loader2,
  Package,
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
interface BundleMintTask {
  id: string;
  contractAddress: string;
  kind: "SEADROP" | "CUSTOM";
  mode: "MULTI_WALLET" | "SINGLE_WALLET_MULTI_TX";
  status: string;
  createdAt: string;
}

type Kind = "SEADROP" | "CUSTOM";
type Mode = "MULTI_WALLET" | "SINGLE_WALLET_MULTI_TX" | "EIP7702";
type Chain = "ethereum" | "base" | "robinhood";
type GasModeExtended = GasMode | "advanced";

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortAddr(addr: string) {
  return `${addr.slice(0, 8)}…${addr.slice(-4)}`;
}
function chainToNetwork(chain: Chain): "ETHEREUM" | "BASE" | "ROBINHOOD" {
  return chain === "base" ? "BASE" : chain === "robinhood" ? "ROBINHOOD" : "ETHEREUM";
}
function statusColor(status: string) {
  if (status === "COMPLETED") return "green";
  if (status === "FAILED") return "red";
  if (status === "RUNNING") return "blue";
  if (status === "CANCELED") return "slate";
  return "yellow";
}
function ethToWei(eth: string): string {
  const n = Number(eth || "0");
  if (!Number.isFinite(n) || n < 0) return "0";
  return String(BigInt(Math.round(n * 1e18)));
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BundleMintPage() {
  const queryClient = useQueryClient();

  // contract
  const [contractAddress, setContractAddress] = useState("");
  const [chain, setChain] = useState<Chain>("ethereum");
  const [kind, setKind] = useState<Kind>("SEADROP");
  const [mode, setMode] = useState<Mode>("MULTI_WALLET");

  // seadrop
  const [mintPriceEth, setMintPriceEth] = useState("0");
  const [mintQuantity, setMintQuantity] = useState("1");

  // OpenSea gated phase (allowlist / signed / gtd / fcfs)
  const [openSeaPhase, setOpenSeaPhase] = useState<"public" | "allowlist" | "gtd" | "fcfs">("public");
  const [collectionSlug, setCollectionSlug] = useState("");

  // custom abi
  const [abiFetchResult, setAbiFetchResult] = useState<AbiFetchResult | null>(null);
  const [abiFetchError, setAbiFetchError] = useState<string | null>(null);
  const [abiFetching, setAbiFetching] = useState(false);
  const [selectedFn, setSelectedFn] = useState<AbiFunction | null>(null);
  const [argValues, setArgValues] = useState<Record<string, string>>({});
  const [valueEth, setValueEth] = useState("0");

  // wallets
  const [selectedWalletIds, setSelectedWalletIds] = useState<string[]>([]);
  const [txPerWallet, setTxPerWallet] = useState("2");

  // 7702
  const [sponsorWalletId, setSponsorWalletId] = useState("");
  const [executorAddress, setExecutorAddress] = useState("");
  const [valuePayer, setValuePayer] = useState<"TX_SENDER" | "DELEGATED">("TX_SENDER");
  const [startTimestampMs, setStartTimestampMs] = useState("");

  // bundle controls
  const [blockOffset, setBlockOffset] = useState("1");
  const [maxBlockRetries, setMaxBlockRetries] = useState("3");
  const [targetBlock, setTargetBlock] = useState("");

  // gas
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
  });
  const { data: recentTasks = [], refetch: refetchTasks } = useQuery<BundleMintTask[]>({
    queryKey: ["bundle-mint-tasks"],
    queryFn: () => apiFetch<BundleMintTask[]>("/bundle-mint/tasks"),
  });

  // ── Derived ───────────────────────────────────────────────────────────────
  const compatibleWallets = useMemo(
    () => wallets.filter((w) => w.network === chainToNetwork(chain)),
    [wallets, chain],
  );

  const isSingle = mode === "SINGLE_WALLET_MULTI_TX";
  const is7702 = mode === "EIP7702";
  const gasMode: GasMode = gasModeExtended === "advanced" ? "balanced" : gasModeExtended;

  // tx count drives the per-wallet gas estimate
  const txCount = isSingle
    ? Math.max(1, Number.parseInt(txPerWallet, 10) || 1)
    : Math.max(1, selectedWalletIds.length);

  const gasRec = useMemo(() => {
    if (!gasQuote) return null;
    return buildGasRecommendation({
      gas: gasQuote,
      network: chain as NetworkKey,
      mode: gasMode,
      estimatedGasUnits: DEFAULT_MINT_GAS_UNITS,
      walletCount: txCount,
    });
  }, [gasQuote, chain, gasMode, txCount]);

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
    /^0x[0-9a-fA-F]{40}$/.test(contractAddress.trim()) &&
    selectedWalletIds.length > 0 &&
    (kind === "SEADROP" || Boolean(selectedFn)) &&
    (!isSingle || selectedWalletIds.length === 1) &&
    (!is7702 || (Boolean(sponsorWalletId) && !selectedWalletIds.includes(sponsorWalletId)));

  // ── Handlers ──────────────────────────────────────────────────────────────
  function changeMode(next: Mode) {
    setMode(next);
    if (next === "SINGLE_WALLET_MULTI_TX") {
      setSelectedWalletIds((prev) => prev.slice(0, 1));
    }
  }

  function toggleWallet(id: string) {
    if (is7702 && id === sponsorWalletId) return; // sponsor can't also be a sub-wallet
    if (isSingle) {
      setSelectedWalletIds((prev) => (prev[0] === id ? [] : [id]));
      return;
    }
    setSelectedWalletIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

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

  const createTask = useMutation({
    mutationFn: () => {
      const addr = contractAddress.trim();
      const body: Record<string, unknown> = {
        contractAddress: addr,
        chain: chainToNetwork(chain),
        kind,
        mode,
        walletIds: selectedWalletIds,
        gasSettings: effectiveGasSettings,
        mintQuantity: Math.max(1, Number.parseInt(mintQuantity, 10) || 1),
        txPerWallet: Math.max(1, Number.parseInt(txPerWallet, 10) || 1),
        blockOffset: Math.max(1, Number.parseInt(blockOffset, 10) || 1),
        maxBlockRetries: Math.max(0, Number.parseInt(maxBlockRetries, 10) || 0),
        targetBlock: targetBlock.trim() || undefined,
      };
      if (collectionSlug.trim()) {
        body.collectionSlug = collectionSlug.trim();
        body.openSeaPhase = openSeaPhase;
      }
      if (is7702) {
        body.sponsorWalletId = sponsorWalletId;
        body.executorAddress = executorAddress.trim() || undefined;
        body.valuePayer = valuePayer;
        body.startTimestampMs = startTimestampMs.trim() || undefined;
      }
      if (kind === "SEADROP") {
        body.mintPriceWei = ethToWei(mintPriceEth);
      } else {
        if (!selectedFn) throw new Error("Select a function.");
        body.functionName = selectedFn.name;
        body.functionAbi = selectedFn;
        body.callArgs = (selectedFn.inputs ?? []).map((inp) => argValues[inp.name] ?? "");
        body.valueWei = isPayable ? ethToWei(valueEth) : "0";
      }
      return apiFetch<BundleMintTask>("/bundle-mint/tasks", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: (task) => {
      setMessage(`Bundle created (${task.id.slice(0, 8)}…). Submitting…`);
      void runTask.mutateAsync(task.id);
    },
    onError: (err) =>
      setMessage(err instanceof Error ? err.message : "Failed to create bundle."),
  });

  const runTask = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean }>(`/bundle-mint/tasks/${id}/run`, { method: "POST" }),
    onSuccess: () => {
      setMessage("Bundle submitted — wallets are minting in one block.");
      void refetchTasks();
      void queryClient.invalidateQueries({ queryKey: ["bundle-mint-tasks"] });
    },
    onError: (err) =>
      setMessage(err instanceof Error ? err.message : "Failed to submit bundle."),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canCreate) {
      setMessage("Fill in all required fields.");
      return;
    }
    createTask.mutate();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppShell title="Bundle Mint">
      <form className="space-y-5" onSubmit={handleSubmit}>
        {/* Summary bar */}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="metric-card">
            <p className="label-caps">Mode</p>
            <p className="metric-value text-[16px]">
              {isSingle ? "Single · multi-tx" : "Multi-wallet"}
            </p>
          </div>
          <div className="metric-card">
            <p className="label-caps">Type</p>
            <p className="metric-value text-[18px]">{kind === "SEADROP" ? "SeaDrop" : "Custom"}</p>
          </div>
          <div className="metric-card">
            <p className="label-caps">{isSingle ? "Txs in bundle" : "Wallets"}</p>
            <p className="metric-value">{txCount}</p>
          </div>
          <div className="metric-card">
            <p className="label-caps">Chain</p>
            <p className="metric-value text-[18px] capitalize">{chain}</p>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            {/* ── Step 1: Contract ─────────────────────────────────────────── */}
            <Panel>
              <div className="panel-header">
                <div>
                  <p className="text-[14px] font-semibold text-graphite-100">
                    Step 1 — Collection & Bundle Type
                  </p>
                  <p className="mt-0.5 text-[12px] text-graphite-500">
                    All txs land atomically in one block — Flashbots bundle on Ethereum, fast
                    parallel broadcast on Base.
                  </p>
                </div>
                <Layers size={17} className="text-graphite-500" />
              </div>
              <div className="space-y-4 p-5">
                <div className="flex flex-col gap-3 md:flex-row">
                  <Input
                    className="flex-1 font-mono"
                    value={contractAddress}
                    onChange={(e) => setContractAddress(e.target.value)}
                    placeholder="0x… NFT contract"
                  />
                  <select
                    value={chain}
                    onChange={(e) => {
                      setChain(e.target.value as Chain);
                      setSelectedWalletIds([]);
                    }}
                    className="rounded-md border border-graphite-700 bg-graphite-800 px-3 py-2 text-[13px] text-graphite-100 focus:border-brand focus:outline-none"
                  >
                    <option value="ethereum">Ethereum</option>
                    <option value="base">Base</option>
                    <option value="robinhood">Robinhood</option>
                  </select>
                </div>

                {/* Kind toggle */}
                <div className="grid gap-2 md:grid-cols-2">
                  {(["SEADROP", "CUSTOM"] as Kind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      className={`rounded-md border px-3 py-2.5 text-left transition-colors ${
                        kind === k
                          ? "border-brand bg-brand-bg"
                          : "border-graphite-700 bg-graphite-800 hover:border-graphite-600"
                      }`}
                    >
                      <span className="text-[13px] font-medium text-graphite-100">
                        {k === "SEADROP" ? "OpenSea SeaDrop" : "Custom Contract"}
                      </span>
                      <p className="mt-0.5 text-[11px] text-graphite-500">
                        {k === "SEADROP"
                          ? "Just price + quantity — mintPublic()"
                          : "Any write function via ABI"}
                      </p>
                    </button>
                  ))}
                </div>

                {/* OpenSea phase — allowlist / signed (GTD/FCFS) via OpenSea per-wallet payload */}
                <div className="grid gap-3 rounded-md border border-graphite-700 bg-graphite-800/60 p-4 md:grid-cols-2">
                  <label>
                    <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                      Phase
                    </span>
                    <Select
                      value={openSeaPhase}
                      onChange={(e) =>
                        setOpenSeaPhase(e.target.value as "public" | "allowlist" | "gtd" | "fcfs")
                      }
                    >
                      <option value="public">Public</option>
                      <option value="allowlist">Allowlist</option>
                      <option value="gtd">GTD (signed)</option>
                      <option value="fcfs">FCFS (signed)</option>
                    </Select>
                  </label>
                  {openSeaPhase !== "public" && (
                    <label>
                      <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                        OpenSea collection slug *
                      </span>
                      <Input
                        value={collectionSlug}
                        onChange={(e) => setCollectionSlug(e.target.value)}
                        placeholder="e.g. my-drop"
                      />
                    </label>
                  )}
                  {openSeaPhase !== "public" && (
                    <p className="text-[10px] text-graphite-500 md:col-span-2">
                      Allowlist / signed: per-wallet proof &amp; signature are fetched from OpenSea
                      automatically (works across all bundle modes). Wallets must be eligible.
                    </p>
                  )}
                </div>

                {/* SeaDrop inputs (price ignored for gated phases — OpenSea supplies it) */}
                {kind === "SEADROP" && (
                  <div className="grid gap-3 rounded-md border border-graphite-700 bg-graphite-800/60 p-4 md:grid-cols-2">
                    <label>
                      <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                        Mint price per NFT (ETH)
                      </span>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={mintPriceEth}
                        onChange={(e) => setMintPriceEth(e.target.value)}
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                        Quantity per tx
                      </span>
                      <Input
                        type="number"
                        min="1"
                        max="50"
                        value={mintQuantity}
                        onChange={(e) => setMintQuantity(e.target.value)}
                      />
                    </label>
                  </div>
                )}

                {/* Custom: ABI fetch */}
                {kind === "CUSTOM" && (
                  <div className="space-y-3">
                    <Button
                      type="button"
                      onClick={handleFetchAbi}
                      disabled={abiFetching || !contractAddress.trim()}
                    >
                      {abiFetching ? (
                        <span className="flex items-center gap-1.5">
                          <Loader2 size={13} className="animate-spin" /> Fetching…
                        </span>
                      ) : (
                        "Load ABI"
                      )}
                    </Button>
                    {abiFetchError && (
                      <p className="rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-[12px] text-status-red-text">
                        {abiFetchError}
                      </p>
                    )}
                    {abiFetchResult && (
                      <p className="flex items-center gap-2 text-[12px] text-status-green-text">
                        <CheckCircle2 size={13} />
                        {abiFetchResult.functions.length} write function
                        {abiFetchResult.functions.length !== 1 ? "s" : ""} found.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </Panel>

            {/* ── Custom: function picker ──────────────────────────────────── */}
            {kind === "CUSTOM" && abiFetchResult && (
              <Panel>
                <div className="panel-header">
                  <p className="text-[14px] font-semibold text-graphite-100">
                    Select Mint Function
                  </p>
                  <Code2 size={17} className="text-graphite-500" />
                </div>
                <div className="space-y-3 p-5">
                  <div className="grid gap-2 md:grid-cols-2">
                    {abiFetchResult.functions.map((fn) => {
                      const sel = selectedFn?.name === fn.name;
                      return (
                        <button
                          key={fn.name}
                          type="button"
                          onClick={() => {
                            setSelectedFn(fn);
                            setArgValues({});
                          }}
                          className={`rounded-md border px-3 py-2.5 text-left transition-colors ${
                            sel
                              ? "border-brand bg-brand-bg"
                              : "border-graphite-700 bg-graphite-800 hover:border-graphite-600"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[13px] font-medium text-graphite-100">
                              {fn.name}
                            </span>
                            {fn.stateMutability === "payable" && <Badge tone="yellow">payable</Badge>}
                            {sel && <ChevronRight size={13} className="text-brand" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {selectedFn && (selectedFn.inputs.length > 0 || isPayable) && (
                    <div className="space-y-3 rounded-md border border-graphite-700 bg-graphite-800/60 p-4">
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
                          />
                        </label>
                      )}
                    </div>
                  )}
                </div>
              </Panel>
            )}

            {/* ── Step 2: Bundle mode ──────────────────────────────────────── */}
            <Panel>
              <div className="panel-header">
                <p className="text-[14px] font-semibold text-graphite-100">Step 2 — Bundle Mode</p>
                <Package size={17} className="text-graphite-500" />
              </div>
              <div className="space-y-3 p-5">
                <div className="grid gap-2 md:grid-cols-3">
                  {(
                    [
                      ["MULTI_WALLET", "Multi-wallet", "Flashbots bundle, one tx per wallet"],
                      ["SINGLE_WALLET_MULTI_TX", "Single · multi-tx", "One wallet fires N txs in a block"],
                      ["EIP7702", "EIP-7702 atomic", "Sub-wallets delegate; main wallet sends 1 tx"],
                    ] as [Mode, string, string][]
                  ).map(([m, label, desc]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => changeMode(m)}
                      className={`rounded-md border px-3 py-2.5 text-left transition-colors ${
                        mode === m
                          ? "border-brand bg-brand-bg"
                          : "border-graphite-700 bg-graphite-800 hover:border-graphite-600"
                      }`}
                    >
                      <span className="text-[13px] font-medium text-graphite-100">{label}</span>
                      <p className="mt-0.5 text-[11px] text-graphite-500">{desc}</p>
                    </button>
                  ))}
                </div>
                {isSingle && (
                  <label className="block max-w-[200px]">
                    <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                      Txs from the wallet
                    </span>
                    <Input
                      type="number"
                      min="1"
                      max="50"
                      value={txPerWallet}
                      onChange={(e) => setTxPerWallet(e.target.value)}
                    />
                  </label>
                )}

                {is7702 && (
                  <div className="space-y-3 rounded-md border border-graphite-700 bg-graphite-800/60 p-4">
                    <p className="text-[11px] text-graphite-400">
                      Sub-wallets sign 7702 authorizations (gasless). The{" "}
                      <span className="text-graphite-200">main wallet pays all gas + mint ETH</span>{" "}
                      and sends one atomic transaction.
                    </p>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                        Main / sponsor wallet
                      </span>
                      <Select
                        value={sponsorWalletId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setSponsorWalletId(id);
                          setSelectedWalletIds((prev) => prev.filter((x) => x !== id));
                        }}
                      >
                        <option value="">Select sponsor…</option>
                        {compatibleWallets.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name} · {shortAddr(w.address)}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                        Executor address (optional — defaults to configured BundleMint7702)
                      </span>
                      <Input
                        className="font-mono"
                        value={executorAddress}
                        onChange={(e) => setExecutorAddress(e.target.value)}
                        placeholder="0x… deployed BundleMint7702"
                      />
                    </label>

                    {/* Value Payer */}
                    <div>
                      <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                        Value payer (who pays the mint price)
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        {(
                          [
                            ["TX_SENDER", "Tx Sender wallet"],
                            ["DELEGATED", "Delegated wallet"],
                          ] as ["TX_SENDER" | "DELEGATED", string][]
                        ).map(([v, label]) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => setValuePayer(v)}
                            className={`rounded-md border px-3 py-2 text-[12px] transition-colors ${
                              valuePayer === v
                                ? "border-brand bg-brand-bg text-graphite-100"
                                : "border-graphite-700 bg-graphite-800 text-graphite-300 hover:border-graphite-600"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1 text-[10px] text-graphite-500">
                        {valuePayer === "TX_SENDER"
                          ? "Main wallet forwards mint ETH — sub-wallets need no balance."
                          : "Each sub-wallet pays from its own balance; main wallet pays gas only."}
                      </p>
                    </div>

                    {/* Timestamp To Start */}
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                        Timestamp to start (ms epoch — optional, for timed mints)
                      </span>
                      <Input
                        className="font-mono"
                        value={startTimestampMs}
                        onChange={(e) => setStartTimestampMs(e.target.value)}
                        placeholder="none — fires immediately"
                      />
                    </label>
                  </div>
                )}
              </div>
            </Panel>

            {/* ── Step 3: Wallets ──────────────────────────────────────────── */}
            <Panel>
              <div className="panel-header">
                <div>
                  <p className="text-[14px] font-semibold text-graphite-100">
                    Step 3 — Select Wallet{isSingle ? "" : "s"}
                  </p>
                  <p className="mt-0.5 text-[12px] text-graphite-500">
                    {isSingle
                      ? "Pick one wallet — it fires every tx in the bundle."
                      : "Each wallet contributes one tx to the bundle."}
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
                  compatibleWallets
                    .filter((w) => !(is7702 && w.id === sponsorWalletId))
                    .map((wallet) => {
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
          </div>

          {/* ── Right column ──────────────────────────────────────────────── */}
          <div className="space-y-5">
            {/* Bundle settings — Flashbots/parallel only (7702 is a single atomic tx) */}
            {!is7702 && (
            <Panel>
              <div className="panel-header">
                <p className="text-[14px] font-semibold text-graphite-100">Bundle Targeting</p>
              </div>
              <div className="grid gap-3 p-5 md:grid-cols-2">
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                    Block offset
                  </span>
                  <Input
                    type="number"
                    min="1"
                    max="20"
                    value={blockOffset}
                    onChange={(e) => setBlockOffset(e.target.value)}
                  />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                    Max block retries
                  </span>
                  <Input
                    type="number"
                    min="0"
                    max="10"
                    value={maxBlockRetries}
                    onChange={(e) => setMaxBlockRetries(e.target.value)}
                  />
                </label>
                <label className="md:col-span-2">
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                    Target block (optional — overrides offset)
                  </span>
                  <Input
                    className="font-mono"
                    value={targetBlock}
                    onChange={(e) => setTargetBlock(e.target.value)}
                    placeholder="auto (current + offset)"
                  />
                </label>
              </div>
            </Panel>
            )}

            {/* Gas */}
            <Panel>
              <div className="panel-header">
                <p className="text-[14px] font-semibold text-graphite-100">Gas</p>
              </div>
              <div className="space-y-4 p-5">
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
                  <div className="rounded-md border border-graphite-700 bg-graphite-800/60">
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
                                setAdvancedGas((g) => ({ ...g, [key]: Number(e.target.value) }))
                              }
                            />
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="rounded-md border border-graphite-700 bg-graphite-800/50 px-3 py-3 text-[12px]">
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-graphite-400">
                    <Flame size={12} className="text-orange-400" />
                    Bundle Gas Estimate
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
                        <span>Est. total ({txCount} tx)</span>
                        <span className="font-mono text-orange-300">
                          ~{(gasRec.estimatedGasCostEth * txCount).toFixed(5)} ETH
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
                  { ok: /^0x[0-9a-fA-F]{40}$/.test(contractAddress.trim()), label: "Valid contract" },
                  { ok: kind === "SEADROP" || Boolean(selectedFn), label: "Mint method set" },
                  {
                    ok: selectedWalletIds.length > 0 && (!isSingle || selectedWalletIds.length === 1),
                    label: isSingle ? "One wallet selected" : "At least one wallet",
                  },
                  ...(is7702
                    ? [{ ok: Boolean(sponsorWalletId), label: "Sponsor wallet set" }]
                    : []),
                ].map(({ ok, label }) => (
                  <p key={label} className="flex items-center gap-2">
                    <CheckCircle2
                      size={14}
                      className={ok ? "text-status-green-text" : "text-graphite-600"}
                    />
                    {label}
                  </p>
                ))}

                {message && <p className="notice text-[12px]">{message}</p>}

                <Button
                  className="w-full"
                  disabled={!canCreate || createTask.isPending || runTask.isPending}
                >
                  {createTask.isPending || runTask.isPending
                    ? "Submitting bundle…"
                    : `Bundle Mint (${txCount} tx)`}
                </Button>
              </div>
            </Panel>
          </div>
        </div>

        {/* ── Recent bundles ──────────────────────────────────────────────── */}
        {recentTasks.length > 0 && (
          <Panel>
            <div className="panel-header">
              <p className="text-[14px] font-semibold text-graphite-100">Recent Bundles</p>
            </div>
            <div className="divide-y divide-graphite-700">
              {recentTasks.slice(0, 10).map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between gap-4 px-5 py-3 text-[13px]"
                >
                  <div className="min-w-0">
                    <p className="font-mono font-medium text-graphite-100 truncate">
                      {task.kind} · {task.mode === "MULTI_WALLET" ? "multi-wallet" : "multi-tx"}
                    </p>
                    <p className="font-mono text-[11px] text-graphite-500 truncate">
                      {shortAddr(task.contractAddress)}
                    </p>
                  </div>
                  <Badge
                    tone={statusColor(task.status) as "green" | "red" | "blue" | "yellow" | "slate"}
                  >
                    {task.status}
                  </Badge>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </form>
    </AppShell>
  );
}
