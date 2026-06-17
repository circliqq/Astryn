"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Flame,
  Repeat2,
  Shield,
  WalletCards,
  XCircle,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel, Select } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { formatDateShort } from "@/lib/format-date";
import {
  buildGasRecommendation,
  DEFAULT_MINT_GAS_UNITS,
  ethForGas,
  GAS_PRESETS,
  loadSavedGasSettings,
  type GasMode,
  type GasQuote,
  type GasSettings,
  type NetworkKey,
} from "@/lib/gas-settings";
import AdvancedGasModal, {
  type AdvancedGasModalSettings,
  type ModalCurrency,
} from "./advanced-gas-modal";

// ── ETH price helper ──────────────────────────────────────────────────────────
async function fetchEthUsdPrice(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { cache: "no-store" }
    );
    const json = await res.json();
    return json?.ethereum?.usd ?? null;
  } catch {
    return null;
  }
}

interface Wallet {
  id: string;
  name: string;
  address: string;
  network: "BASE" | "ETHEREUM";
  status: string;
}

interface CollectionPhase {
  id: string;
  phaseType: "PUBLIC" | "ALLOWLIST" | "GTD" | "FCFS";
  name: string | null;
  priceWei: string;
  startTime: string;
  endTime: string | null;
  maxMint: number | null;
}

interface Collection {
  id: string;
  name: string;
  slug: string;
  chain: "BASE" | "ETHEREUM";
  contractAddress: string;
  imageUrl: string | null;
  phases: CollectionPhase[];
}

type ExtendedGasMode = GasMode | "advanced";

interface WhitelistCheckerStage {
  stage: string;
  stageType: string;
  stageIndex: number | null;
  maxMint: number;
}

interface WhitelistCheckerWallet {
  walletId: string;
  eligible: boolean;
  stages: WhitelistCheckerStage[];
  error: string | null;
}

interface WhitelistCheckerResult {
  wallets: WhitelistCheckerWallet[];
}

type WalletEligibilityStatus = "checking" | "eligible" | "not_eligible" | "error";

function formatEth(wei: string) {
  try {
    return `${(Number(BigInt(wei)) / 1e18).toFixed(4)} ETH`;
  } catch {
    return "0.0000 ETH";
  }
}

function weiToEth(wei: string): number {
  try {
    return Number(BigInt(wei)) / 1e18;
  } catch {
    return 0;
  }
}


export default function MintSetupPage() {
  return (
    <Suspense fallback={<MintSetupFallback />}>
      <MintSetupContent />
    </Suspense>
  );
}

function MintSetupFallback() {
  return (
    <AppShell title="Mint Setup">
      <Panel className="p-8 text-[13px] text-graphite-400">Loading mint setup...</Panel>
    </AppShell>
  );
}

function MintSetupContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const collectionId = searchParams.get("collectionId") ?? "";

  // Selection is keyed by the unique phase id (not phaseType) so that two distinct
  // phases sharing an enum type — e.g. a free "Team Mint" and a paid "Whitelist Mint",
  // both ALLOWLIST — stay independently selectable instead of collapsing into one.
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const [selectedWalletIds, setSelectedWalletIds] = useState<string[]>([]);
  const [gasModeExtended, setGasModeExtended] = useState<ExtendedGasMode>(() => loadSavedGasSettings().mode);
  const [advancedGas, setAdvancedGas] = useState<
    Pick<GasSettings, "maxFeeGwei" | "priorityFeeGwei" | "maxTotalGasCostEth" | "maxBumpAttempts"> & {
      gasLimitUnits: number;
      gasBudget: string;
      gasBudgetCurrency: ModalCurrency;
      spendingMode: "speed" | "economy";
    }
  >({
    maxFeeGwei: 50,
    priorityFeeGwei: 2,
    maxTotalGasCostEth: 0.005,
    maxBumpAttempts: 3,
    gasLimitUnits: DEFAULT_MINT_GAS_UNITS,
    gasBudget: "",
    gasBudgetCurrency: "ETH",
    spendingMode: "speed",
  });
  const [gasModalOpen, setGasModalOpen] = useState(false);

  // ETH/USD price for budget conversion
  const { data: ethUsdPrice } = useQuery<number | null>({
    queryKey: ["eth-usd-price"],
    queryFn: fetchEthUsdPrice,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const [mintQuantity, setMintQuantity] = useState("1");
  const [scheduleMode, setScheduleMode] = useState<"draft" | "phase_start" | "custom">("draft");
  const [scheduleAt, setScheduleAt] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [dragWalletId, setDragWalletId] = useState<string | null>(null);

  // ── Phase name overrides (user can manually type real names) ─────────────
  const [phaseNameOverrides, setPhaseNameOverrides] = useState<Record<string, string>>({});
  const [editingPhaseName, setEditingPhaseName] = useState<string | null>(null);
  const [walletEligibility, setWalletEligibility] = useState<Map<string, WalletEligibilityStatus>>(new Map());


  // ── Instant Flipper state ─────────────────────────────────────────────────
  const [flipperEnabled, setFlipperEnabled]         = useState(false);
  const [flipperOpen, setFlipperOpen]               = useState(false);
  const [flipperMode, setFlipperMode]               = useState<"auto" | "manual">("auto");
  const [flipperPriceMode, setFlipperPriceMode]     = useState<"floor_percent" | "fixed">("floor_percent");
  const [flipperMultiplier, setFlipperMultiplier]   = useState("0.98");
  const [flipperFixedPrice, setFlipperFixedPrice]   = useState("");
  const [flipperMinPrice, setFlipperMinPrice]       = useState("");
  const [flipperMaxPerWallet, setFlipperMaxPerWallet] = useState("1");

  // ── Priority Mode state ───────────────────────────────────────────────────────
  const [priorityModeEnabled, setPriorityModeEnabled] = useState(false);
  const [priorityModeOpen, setPriorityModeOpen]       = useState(false);
  const [priorityMaxTx, setPriorityMaxTx]             = useState("");
  const [prioritySupplyBuffer, setPrioritySupplyBuffer] = useState("");
  // Ordered list of selected wallet IDs — first = highest priority
  const [priorityWalletOrder, setPriorityWalletOrder] = useState<string[]>([]);

  // ── Data fetching ─────────────────────────────────────────────────────────────

  const { data: wallets = [] } = useQuery<Wallet[]>({
    queryKey: ["wallets"],
    queryFn: () => apiFetch<Wallet[]>("/wallets"),
  });

  const { data: collection, isLoading: collectionLoading } = useQuery<Collection>({
    queryKey: ["collection", collectionId],
    enabled: Boolean(collectionId),
    queryFn: () => apiFetch<Collection>(`/collections/${collectionId}`),
  });

  const { data: gasQuote } = useQuery<GasQuote>({
    queryKey: ["gas-current", collection?.chain],
    enabled: Boolean(collection),
    queryFn: () =>
      apiFetch<GasQuote>(`/gas/current?network=${(collection!.chain ?? "ethereum").toLowerCase()}`),
    refetchInterval: 15_000,
  });

  // compatibleWallets + selectedPhase needed early for simulation query
  const compatibleWallets = useMemo(() => {
    if (!collection) return wallets;
    return wallets.filter((w) => w.network === collection.chain);
  }, [collection, wallets]);

  const selectedPhase = useMemo(() => {
    if (!collection || collection.phases.length === 0) return null;
    return (
      collection.phases.find((p) => p.id === selectedPhaseId) ??
      // Default to the public phase if present, else the first phase.
      collection.phases.find((p) => p.phaseType === "PUBLIC") ??
      collection.phases[0] ??
      null
    );
  }, [collection, selectedPhaseId]);

  // Enum type derived from the currently selected phase. Task scheduling still
  // operates on the 4-value enum.
  const phaseType: CollectionPhase["phaseType"] = selectedPhase?.phaseType ?? "PUBLIC";

  // Initialise / repair the selection whenever the collection (and its phases) load.
  useEffect(() => {
    if (!collection || collection.phases.length === 0) return;
    const stillValid = collection.phases.some((p) => p.id === selectedPhaseId);
    if (!stillValid) {
      const fallback =
        collection.phases.find((p) => p.phaseType === "PUBLIC") ?? collection.phases[0];
      setSelectedPhaseId(fallback?.id ?? null);
    }
  }, [collection, selectedPhaseId]);

  useEffect(() => {
    if (!collection || compatibleWallets.length === 0) {
      setWalletEligibility(new Map());
      return;
    }

    if (phaseType === "PUBLIC") {
      setWalletEligibility(new Map(compatibleWallets.map((wallet) => [wallet.id, "eligible"])));
      return;
    }

    const walletIds = compatibleWallets.map((wallet) => wallet.id);
    let cancelled = false;
    setWalletEligibility(new Map(walletIds.map((id) => [id, "checking"])));

    apiFetch<WhitelistCheckerResult>("/whitelist-checker/bulk", {
      method: "POST",
      body: JSON.stringify({
        collection: collection.slug,
        walletIds,
        network: collection.chain.toLowerCase(),
      }),
    })
      .then((data) => {
        if (cancelled) return;
        const next = new Map<string, WalletEligibilityStatus>();
        for (const wallet of data.wallets) {
          if (wallet.error) {
            next.set(wallet.walletId, "error");
            continue;
          }
          next.set(wallet.walletId, wallet.eligible ? "eligible" : "not_eligible");
        }
        for (const id of walletIds) {
          if (!next.has(id)) next.set(id, "not_eligible");
        }
        setWalletEligibility(next);
      })
      .catch(() => {
        if (!cancelled) {
          setWalletEligibility(new Map(walletIds.map((id) => [id, "error"])));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [collection, compatibleWallets, phaseType]);

  // ── Gas simulation — fires when collection + at least one wallet is ready ────
  // Uses the first selected wallet (or first compatible wallet) to call
  // eth_estimateGas on-chain and get a precise gas limit recommendation.
  const simulationWalletAddress = useMemo(() => {
    if (selectedWalletIds.length > 0) {
      return wallets.find((w) => w.id === selectedWalletIds[0])?.address ?? null;
    }
    return compatibleWallets[0]?.address ?? null;
  }, [selectedWalletIds, wallets, compatibleWallets]);

  type GasSimResult =
    | { estimatedGas: number; recommendedLimit: number; bufferMultiplier: number; simulated: true }
    | { estimatedGas: null; recommendedLimit: number; bufferMultiplier: number; simulated: false; reason: string };

  const {
    data: gasSim,
    isFetching: gasSimFetching,
  } = useQuery<GasSimResult>({
    queryKey: [
      "gas-simulate-mint",
      collection?.contractAddress,
      simulationWalletAddress,
      collection?.chain,
      selectedPhase?.priceWei,
      mintQuantity,
    ],
    enabled: Boolean(collection?.contractAddress && simulationWalletAddress && selectedPhase),
    queryFn: () =>
      apiFetch<GasSimResult>("/gas/simulate-mint", {
        method: "POST",
        body: JSON.stringify({
          contractAddress: collection!.contractAddress,
          walletAddress: simulationWalletAddress,
          network: (collection!.chain ?? "ETHEREUM").toLowerCase(),
          priceWei: selectedPhase?.priceWei ?? "0",
          quantity: Math.max(1, Number.parseInt(mintQuantity, 10) || 1),
        }),
      }),
    staleTime: 60_000,
    retry: 1,
  });

  // ── Derived values ────────────────────────────────────────────────────────────



  // Sync priority wallet order: add newly selected wallets to end, remove deselected ones
  useEffect(() => {
    setPriorityWalletOrder((prev) => {
      const kept = prev.filter((id) => selectedWalletIds.includes(id));
      const added = selectedWalletIds.filter((id) => !prev.includes(id));
      return [...kept, ...added];
    });
  }, [selectedWalletIds]);


  // Effective gas mode for calculations (advanced → balanced multipliers)
  const gasMode: GasMode = gasModeExtended === "advanced" ? "balanced" : gasModeExtended;

  const gasRec = useMemo(() => {
    if (!gasQuote || !collection) return null;
    return buildGasRecommendation({
      gas: gasQuote,
      network: collection.chain.toLowerCase() as NetworkKey,
      mode: gasMode,
      estimatedGasUnits: DEFAULT_MINT_GAS_UNITS,
      walletCount: Math.max(1, selectedWalletIds.length),
    });
  }, [gasQuote, collection, gasMode, selectedWalletIds.length]);

  const qty = Math.max(1, Number.parseInt(mintQuantity, 10) || 1);
  const mintPriceEth = selectedPhase ? weiToEth(selectedPhase.priceWei) : 0;

  // Budget in ETH (convert from USD/GWEI if needed) — must be before effectiveGasSettings
  const gasBudgetEth = (() => {
    const raw = Number(advancedGas.gasBudget);
    if (!raw || raw <= 0) return 0;
    if (advancedGas.gasBudgetCurrency === "USD") {
      return ethUsdPrice && ethUsdPrice > 0 ? raw / ethUsdPrice : 0;
    }
    if (advancedGas.gasBudgetCurrency === "GWEI") {
      return (raw * advancedGas.gasLimitUnits) / 1e9;
    }
    return raw; // ETH
  })();

  // Effective gas settings sent to API
  const effectiveGasSettings: GasSettings =
    gasModeExtended === "advanced"
      ? {
          mode: "balanced",
          maxFeeGwei: advancedGas.maxFeeGwei,
          priorityFeeGwei: advancedGas.priorityFeeGwei,
          // If budget is set, cap per-wallet to budget / walletCount
          maxTotalGasCostEth: gasBudgetEth > 0 && selectedWalletIds.length > 0
            ? Math.min(advancedGas.maxTotalGasCostEth, gasBudgetEth / Math.max(1, selectedWalletIds.length))
            : advancedGas.maxTotalGasCostEth,
          gasBumpEnabled: true,
          maxBumpAttempts: advancedGas.maxBumpAttempts,
        }
      : GAS_PRESETS[gasMode];

  const gasCostPerWallet = (() => {
    if (!gasRec) return 0;
    if (gasModeExtended === "advanced") {
      // Advanced mode: use custom gas limit units + custom fee values
      const gasUnits = advancedGas.gasLimitUnits > 0 ? advancedGas.gasLimitUnits : gasRec.estimatedGasUnits;
      const effectiveGwei = Math.min(
        advancedGas.maxFeeGwei,
        gasRec.liveBaseGwei + advancedGas.priorityFeeGwei
      );
      return Math.max(0, ethForGas(gasUnits, effectiveGwei));
    }
    return Math.max(0, gasRec.estimatedGasCostEth);
  })();
  const totalCostPerWallet = (mintPriceEth + gasCostPerWallet) * qty;
  const grandTotal = totalCostPerWallet * Math.max(1, selectedWalletIds.length);

  const canCreate = Boolean(collection && selectedWalletIds.length > 0);

  function toggleWallet(id: string) {
    setSelectedWalletIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    );
  }

  const createTask = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>("/mint-tasks", {
        method: "POST",
        body: JSON.stringify({
          collectionId,
          walletIds: selectedWalletIds,
          phaseType,
          gasSettings: effectiveGasSettings,
          // For "phase_start" we pass the exact stored start time so the backend
          // doesn't need to re-resolve the phase type (avoids "No matching phase" errors
          // when GTD/FCFS are stored as ALLOWLIST after a live refresh).
          scheduleMode: "draft",
          scheduleAt: (() => {
            if (scheduleMode === "phase_start" && selectedPhase) {
              return new Date(selectedPhase.startTime).toISOString();
            }
            if (scheduleMode === "custom" && scheduleAt) {
              return new Date(scheduleAt).toISOString();
            }
            return undefined;
          })(),
          mintQuantity: qty,
          instantFlipper: flipperEnabled ? {
            enabled: true,
            mode: flipperMode,
            priceMode: flipperPriceMode,
            floorMultiplier: flipperPriceMode === "floor_percent" ? Number(flipperMultiplier) || 0.98 : undefined,
            fixedPriceEth: flipperPriceMode === "fixed" ? Number(flipperFixedPrice) || undefined : undefined,
            minPriceEth: flipperMinPrice ? Number(flipperMinPrice) : undefined,
            maxPerWallet: Math.max(1, Number.parseInt(flipperMaxPerWallet, 10) || 1),
          } : { enabled: false },
          priorityWalletIds: priorityModeEnabled ? priorityWalletOrder : undefined,
          priorityMinting: priorityModeEnabled ? {
            enabled: true,
            maxTransactions: priorityMaxTx ? Math.max(1, Number.parseInt(priorityMaxTx, 10) || 1) : undefined,
            supplyBuffer: prioritySupplyBuffer ? Math.max(0, Number.parseInt(prioritySupplyBuffer, 10) || 0) : undefined,
            priorityWalletIds: priorityWalletOrder,
          } : { enabled: false },
        }),
      }),
    onSuccess: (task) => {
      setMessage("Mint task created.");
      router.push(`/mint-tasks?task=${task.id}`);
    },
    onError: (error) =>
      setMessage(
        error instanceof Error ? error.message : "Unable to create mint task."
      ),
  });

  function handleModalSave(s: AdvancedGasModalSettings) {
    const budgetEth = (() => {
      const raw = Number(s.budget);
      if (!raw || raw <= 0) return 0;
      if (s.currency === "USD") return ethUsdPrice && ethUsdPrice > 0 ? raw / ethUsdPrice : 0;
      if (s.currency === "GWEI") return (raw * s.gasLimit) / 1e9;
      return raw;
    })();
    const maxFeeGwei =
      s.gasLimit > 0 && budgetEth > 0
        ? (budgetEth / s.gasLimit) * 1e9
        : advancedGas.maxFeeGwei;
    const priorityFeeGwei =
      s.spendingMode === "speed"
        ? Math.max(maxFeeGwei * 0.1, 0.1)
        : Math.min(0.1, maxFeeGwei * 0.05);
    setAdvancedGas((g) => ({
      ...g,
      gasBudget: s.budget,
      gasBudgetCurrency: s.currency,
      gasLimitUnits: s.gasLimit,
      spendingMode: s.spendingMode,
      maxFeeGwei: Math.max(0.001, maxFeeGwei),
      priorityFeeGwei: Math.max(0, priorityFeeGwei),
      maxTotalGasCostEth: Math.max(0.000001, budgetEth || advancedGas.maxTotalGasCostEth),
    }));
    setGasModeExtended("advanced");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate) {
      setMessage("Choose a scanned collection and at least one wallet.");
      return;
    }
    createTask.mutate();
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <AppShell title="Mint Setup">
      <form className="space-y-5" onSubmit={handleSubmit}>
        {/* ── Summary bar ── */}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="metric-card">
            <p className="label-caps">Collection</p>
            <p className="metric-value text-[20px]">{collection ? "Ready" : "Missing"}</p>
          </div>
          <div className="metric-card">
            <p className="label-caps">Wallets</p>
            <p className="metric-value">{selectedWalletIds.length}</p>
          </div>
          <div className="metric-card">
            <p className="label-caps">Gas mode</p>
            <p className="metric-value text-[20px] capitalize">{gasModeExtended}</p>
          </div>
          <div className="metric-card">
            <p className="label-caps">Quantity</p>
            <p className="metric-value">{mintQuantity}</p>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
          <div className="space-y-5">
            {/* ── Wallet selection (moved above collection) ── */}
            <Panel>
              <div className="panel-header">
                <div>
                  <p className="text-[14px] font-semibold text-graphite-100">Wallet Selection</p>
                  <p className="mt-0.5 text-[12px] text-graphite-500">
                    {collection
                      ? "Select a phase below, then pick wallets for that phase."
                      : "Scan a collection first to see phases and wallets."}
                  </p>
                </div>
                <WalletCards size={17} className="text-graphite-500" />
              </div>

              {/* ── Collection info strip (compact, inside wallet panel) ── */}
              {collection && (
                <div className="mx-5 mt-3 flex items-center gap-3 rounded-md border border-graphite-700 bg-graphite-800/50 px-3 py-2.5">
                  {collection.imageUrl && (
                    <img
                      src={collection.imageUrl}
                      alt={collection.name}
                      className="h-9 w-9 shrink-0 rounded-md border border-graphite-700 object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-graphite-100">{collection.name}</span>
                      <Badge tone="blue">{collection.chain === "BASE" ? "Base" : "Ethereum"}</Badge>
                    </div>
                    <p className="font-mono text-[10px] text-graphite-500">{collection.contractAddress.slice(0, 18)}…</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      className="rounded-md border border-graphite-700 bg-graphite-800 px-2.5 py-1.5 text-[11px] text-graphite-400 hover:border-graphite-600 hover:text-graphite-200 transition-colors"
                      onClick={async () => {
                        await apiFetch(`/collections/${collectionId}/refresh-phases`, { method: "POST" });
                        queryClient.invalidateQueries({ queryKey: ["collection", collectionId] });
                      }}
                    >
                      ↻ Rescan phases
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-graphite-700 bg-graphite-800 px-2.5 py-1.5 text-[11px] text-graphite-400 hover:border-graphite-600 hover:text-graphite-200 transition-colors"
                      onClick={() => router.push("/scanner")}
                    >
                      Change
                    </button>
                  </div>
                </div>
              )}

              {/* ── Phase detail cards — all phases from collection ── */}
              {collection && collection.phases.length > 0 && (() => {
                // Show EVERY phase, ordered by start time, so the list mirrors the
                // official OpenSea mint schedule exactly. Distinct phases that share
                // an enum type (e.g. Team Mint + Whitelist, both ALLOWLIST) each get
                // their own card — keyed by the unique phase id.
                const orderedPhases = [...collection.phases].sort(
                  (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
                );
                return (
                  <div className="px-5 pt-4">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-graphite-500">
                      Collection Phases — select one to filter wallets
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {orderedPhases.map((phase) => {
                        const isActive = selectedPhase?.id === phase.id;
                        const now = Date.now();
                        const start = new Date(phase.startTime).getTime();
                        const end = phase.endTime ? new Date(phase.endTime).getTime() : null;
                        const isLive = now >= start && (end === null || now < end);
                        const isUpcoming = now < start;
                        const isEnded = end !== null && now >= end;
                        const statusLabel = isLive ? "Live" : isUpcoming ? "Upcoming" : isEnded ? "Ended" : "—";
                        const statusColor = isLive
                          ? "text-status-green-text"
                          : isUpcoming
                          ? "text-brand"
                          : "text-graphite-500";
                        return (
                          <button
                            key={phase.id}
                            type="button"
                            onClick={() => setSelectedPhaseId(phase.id)}
                            className={`rounded-lg border p-3 text-left transition-all ${
                              isActive
                                ? "border-brand bg-brand/10 ring-1 ring-brand/30"
                                : "border-graphite-700 bg-graphite-800/60 hover:border-graphite-600"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                {editingPhaseName === phase.id ? (
                                  <input
                                    autoFocus
                                    type="text"
                                    defaultValue={phaseNameOverrides[phase.id] ?? phase.name ?? ""}
                                    placeholder={phase.phaseType}
                                    onClick={(e) => e.stopPropagation()}
                                    onBlur={(e) => {
                                      const val = e.target.value.trim();
                                      setPhaseNameOverrides((prev) => ({ ...prev, [phase.id]: val }));
                                      setEditingPhaseName(null);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                      if (e.key === "Escape") setEditingPhaseName(null);
                                    }}
                                    className="w-full rounded border border-brand bg-transparent px-1.5 py-0.5 text-[12px] font-bold text-brand outline-none"
                                  />
                                ) : (
                                  <div className="flex items-center gap-1.5 group/name min-w-0">
                                    <p className={`truncate text-[12px] font-bold ${isActive ? "text-brand" : "text-graphite-100"}`}>
                                      {phaseNameOverrides[phase.id] || phase.name || phase.phaseType}
                                    </p>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); setEditingPhaseName(phase.id); }}
                                      className="opacity-0 group-hover/name:opacity-100 shrink-0 text-[9px] text-graphite-600 hover:text-graphite-400 transition-opacity"
                                      title="Edit phase name"
                                    >✎</button>
                                  </div>
                                )}
                                {(phaseNameOverrides[phase.id] || phase.name) && (
                                  <p className="text-[10px] text-graphite-600 font-medium uppercase tracking-wide">
                                    {phase.phaseType}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {isActive && <CheckCircle2 size={12} className="text-brand shrink-0" />}
                                <span className={`text-[10px] font-semibold ${statusColor}`}>{statusLabel}</span>
                              </div>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                              <div>
                                <span className="text-graphite-600">Price</span>
                                <p className="font-mono font-medium text-graphite-200">{formatEth(phase.priceWei)}</p>
                              </div>
                              <div>
                                <span className="text-graphite-600">Max mint</span>
                                <p className="font-mono font-medium text-graphite-200">
                                  {phase.maxMint != null ? phase.maxMint : "Unlimited"}
                                </p>
                              </div>
                              <div>
                                <span className="text-graphite-600">Start</span>
                                <p className="font-medium text-graphite-300">{formatDateShort(phase.startTime)}</p>
                              </div>
                              <div>
                                <span className="text-graphite-600">End</span>
                                <p className="font-medium text-graphite-300">
                                  {phase.endTime ? formatDateShort(phase.endTime) : "No end"}
                                </p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {!collection && (
                <div className="empty-state">
                  <div>
                    <p className="font-medium text-graphite-200">No collection loaded yet.</p>
                    <Button type="button" className="mt-4" onClick={() => router.push("/scanner")}>
                      Open Scanner
                    </Button>
                  </div>
                </div>
              )}


              {collection && compatibleWallets.length > 0 && (
                <div className="mx-5 mt-4 flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-graphite-500">
                    Wallets
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-graphite-500">
                      {selectedWalletIds.length}/{compatibleWallets.length} selected
                    </span>
                    {selectedWalletIds.length === compatibleWallets.length ? (
                      <button
                        type="button"
                        onClick={() => setSelectedWalletIds([])}
                        className="rounded-md border border-graphite-700 bg-graphite-800 px-2.5 py-1 text-[11px] font-medium text-graphite-400 hover:border-graphite-600 hover:text-graphite-200 transition-colors"
                      >
                        Deselect all
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setSelectedWalletIds(compatibleWallets.map((w) => w.id))}
                        className="rounded-md border border-brand/50 bg-brand/10 px-2.5 py-1 text-[11px] font-medium text-brand hover:bg-brand/20 transition-colors"
                      >
                        Select all
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="grid gap-2 p-5 md:grid-cols-2 xl:grid-cols-3">
                {compatibleWallets.length === 0 ? (
                  <div className="notice md:col-span-2 xl:col-span-3">No compatible wallets found.</div>
                ) : (
                  compatibleWallets.map((wallet) => {
                    const selected = selectedWalletIds.includes(wallet.id);
                    return (
                      <div
                        key={wallet.id}
                        draggable
                        onDragStart={(e) => {
                          setDragWalletId(wallet.id);
                          e.dataTransfer.effectAllowed = "copy";
                          e.dataTransfer.setData("walletId", wallet.id);
                        }}
                        onDragEnd={() => setDragWalletId(null)}
                        onClick={() => toggleWallet(wallet.id)}
                        className={`relative rounded-lg border-2 p-3 text-left cursor-pointer select-none transition-all ${
                          selected
                            ? "border-brand bg-brand/10 shadow-[0_0_0_1px_rgba(var(--color-brand-rgb,99,102,241),0.3)]"
                            : "border-graphite-700 bg-graphite-800 hover:border-graphite-500 hover:bg-graphite-750"
                        } ${dragWalletId === wallet.id ? "opacity-40 scale-95" : ""}`}
                      >
                        {/* Checkbox top-right */}
                        <div className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all ${
                          selected
                            ? "border-brand bg-brand"
                            : "border-graphite-600 bg-transparent"
                        }`}>
                          {selected && (
                            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                              <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>

                        {/* Wallet name */}
                        <p className={`pr-7 text-[13px] font-semibold truncate ${selected ? "text-white" : "text-graphite-100"}`}>
                          {wallet.name}
                        </p>
                        <p className="mt-0.5 font-mono text-[10px] text-graphite-500">
                          {wallet.address.slice(0, 14)}…
                        </p>

                        {/* Status row */}
                        <div className="mt-2.5 flex items-center justify-between gap-2">
                          {(() => {
                            const status = walletEligibility.get(wallet.id);
                            if (status === "checking") {
                              return <span className="text-[10px] text-graphite-500">Checking...</span>;
                            }
                            if (status === "eligible") {
                              return (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-status-green-text">
                                  <CheckCircle2 size={11} /> Eligible
                                </span>
                              );
                            }
                            if (status === "error") {
                              return (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-status-yellow-text">
                                  <AlertTriangle size={11} /> Check failed
                                </span>
                              );
                            }
                              return (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-status-red-text">
                                <XCircle size={11} /> Not eligible
                              </span>
                            );
                          })()}
                          <span className={`text-[10px] font-semibold ${selected ? "text-brand" : "text-graphite-500"}`}>
                            {selected ? "✓ Selected" : wallet.status}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </Panel>
          </div>

          {/* ── Right column ── */}
          <div className="space-y-5">
            {/* ── Execution panel ── */}
            <Panel>
              <div className="panel-header">
                <p className="text-[14px] font-semibold text-graphite-100">Execution</p>
              </div>
              <div className="space-y-4 p-5">
                {/* Phase */}
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">Phase</span>
                  <Select
                    value={selectedPhase?.id ?? ""}
                    onChange={(e) => setSelectedPhaseId(e.target.value)}
                  >
                    {collection && collection.phases.length > 0 ? (
                      // List every phase (sorted by start time) so the dropdown mirrors
                      // the full OpenSea schedule, keyed by unique phase id.
                      [...collection.phases]
                        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                        .map((phase) => {
                          const dn = phaseNameOverrides[phase.id] || phase.name;
                          return (
                            <option key={phase.id} value={phase.id}>
                              {dn ? `${dn} (${phase.phaseType})` : phase.phaseType} — {formatEth(phase.priceWei)}
                            </option>
                          );
                        })
                    ) : (
                      <option value="">No phases</option>
                    )}
                  </Select>
                </label>

                {/* Quantity */}
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">Mint quantity</span>
                  <Input
                    type="number"
                    min="1"
                    value={mintQuantity}
                    onChange={(e) => setMintQuantity(e.target.value)}
                  />
                </label>

                {/* Gas mode preset selector */}
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">Gas mode</span>
                  <Select
                    value={gasModeExtended === "advanced" ? gasMode : gasModeExtended}
                    disabled={gasModeExtended === "advanced"}
                    onChange={(e) => setGasModeExtended(e.target.value as GasMode)}
                  >
                    <option value="safe">Safe</option>
                    <option value="balanced">Balanced</option>
                    <option value="aggressive">Aggressive</option>
                  </Select>
                </label>

                {/* Advanced Custom — opens modal */}
                <div>
                  <button
                    type="button"
                    onClick={() => setGasModalOpen(true)}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 transition-colors ${
                      gasModeExtended === "advanced"
                        ? "border-brand/50 bg-brand/10 text-graphite-100"
                        : "border-graphite-700 bg-graphite-800/60 text-graphite-400 hover:border-graphite-600 hover:text-graphite-200"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[12px] font-semibold">
                      <Zap size={13} className={gasModeExtended === "advanced" ? "text-brand" : "text-graphite-500"} />
                      Advanced Custom
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      gasModeExtended === "advanced"
                        ? "bg-brand text-white"
                        : "bg-graphite-700 text-graphite-400"
                    }`}>
                      {gasModeExtended === "advanced" ? "Active" : "Off"}
                    </span>
                  </button>

                  {/* Quick summary when advanced is active */}
                  {gasModeExtended === "advanced" && (
                    <div className="mt-1.5 rounded-md border border-graphite-700 bg-graphite-800/40 px-3 py-2 text-[11px] text-graphite-400 tabular-nums">
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span>
                          <span className="text-graphite-500">Max fee </span>
                          <span className="font-mono text-graphite-200">{advancedGas.maxFeeGwei} gwei</span>
                        </span>
                        <span>
                          <span className="text-graphite-500">Gas limit </span>
                          <span className="font-mono text-graphite-200">{advancedGas.gasLimitUnits.toLocaleString()}</span>
                        </span>
                        <span>
                          <span className="text-graphite-500">Mode </span>
                          <span className="font-mono text-graphite-200 capitalize">{advancedGas.spendingMode}</span>
                        </span>
                        {gasBudgetEth > 0 && (
                          <span>
                            <span className="text-graphite-500">Budget </span>
                            <span className="font-mono text-graphite-200">{gasBudgetEth.toFixed(5)} ETH</span>
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setGasModeExtended("balanced")}
                        className="mt-1.5 text-[10px] text-graphite-600 hover:text-graphite-400 underline"
                      >
                        Clear advanced
                      </button>
                    </div>
                  )}
                </div>

                {/* ── Gas simulation result ── */}
                {(gasSimFetching || gasSim) && (
                  <div className={`rounded-md border px-3 py-2.5 text-[11px] ${
                    gasSimFetching
                      ? "border-graphite-700 bg-graphite-800/40"
                      : gasSim?.simulated
                      ? "border-brand/30 bg-brand/5"
                      : "border-graphite-700 bg-graphite-800/40"
                  }`}>
                    {gasSimFetching ? (
                      <span className="flex items-center gap-1.5 text-graphite-500">
                        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand" />
                        Simulating contract on-chain...
                      </span>
                    ) : gasSim?.simulated ? (
                      <div className="flex items-center justify-between gap-2">
                        <div className="space-y-0.5">
                          <p className="flex items-center gap-1 text-graphite-400">
                            <Zap size={10} className="text-brand" />
                            <span className="font-semibold text-graphite-200">
                              {gasSim.estimatedGas.toLocaleString()} gas
                            </span>
                            <span className="text-graphite-600">estimated on-chain</span>
                          </p>
                          <p className="text-graphite-600">
                            → recommend{" "}
                            <span className="font-mono text-graphite-400">
                              {gasSim.recommendedLimit.toLocaleString()}
                            </span>{" "}
                            ({(gasSim.bufferMultiplier * 100 - 100).toFixed(0)}% buffer)
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setAdvancedGas((g) => ({ ...g, gasLimitUnits: gasSim.recommendedLimit }));
                            setGasModeExtended("advanced");
                          }}
                          className="shrink-0 rounded-md bg-brand px-2.5 py-1 text-[10px] font-bold text-white hover:bg-brand/80 transition-colors"
                        >
                          Apply
                        </button>
                      </div>
                    ) : gasSim && !gasSim.simulated ? (
                      <p className="text-graphite-500">
                        Simulation reverted (phase not live or WL required) — using 200,000 fallback.
                      </p>
                    ) : null}
                  </div>
                )}

                {/* Schedule mode */}
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">Schedule mode</span>
                  <Select
                    value={scheduleMode}
                    onChange={(e) =>
                      setScheduleMode(e.target.value as "draft" | "phase_start" | "custom")
                    }
                  >
                    <option value="draft">Save as draft</option>
                    <option value="phase_start">Schedule at phase start</option>
                    <option value="custom">Custom time</option>
                  </Select>
                </label>

                {scheduleMode === "custom" && (
                  <label>
                    <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                      Custom schedule
                    </span>
                    <Input
                      type="datetime-local"
                      value={scheduleAt}
                      onChange={(e) => setScheduleAt(e.target.value)}
                    />
                  </label>
                )}

                {/* Phase timing */}
                <div className="notice text-[12px]">
                  <CalendarClock size={14} className="mb-2 text-graphite-500" />
                  {selectedPhase
                    ? `Phase starts ${formatDateShort(selectedPhase.startTime)}.`
                    : "Select a collection to review phase timing."}
                </div>

                {/* ── Live gas estimate ── */}
                <div className="rounded-md border border-graphite-700 bg-graphite-800/50 px-3 py-3 text-[12px]">
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-graphite-400">
                    <Flame size={12} className="text-orange-400" />
                    Gas Estimate
                    {gasQuote && gasRec && (
                      <span className="ml-auto font-normal normal-case tracking-normal text-graphite-500">
                        Live · {gasRec.liveBaseGwei.toFixed(2)} gwei base
                      </span>
                    )}
                  </div>
                  {!collection ? (
                    <p className="text-graphite-500">Select a collection to see gas estimate.</p>
                  ) : !gasQuote ? (
                    <p className="text-graphite-500">Fetching live gas…</p>
                  ) : gasRec ? (
                    <div className="space-y-1.5 text-graphite-300">
                      <div className="flex justify-between">
                        <span className="text-graphite-400">Max fee</span>
                        <span className="font-mono">
                          {gasModeExtended === "advanced"
                            ? advancedGas.maxFeeGwei
                            : gasRec.settings.maxFeeGwei}{" "}
                          gwei
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-graphite-400">Priority fee</span>
                        <span className="font-mono">
                          {gasModeExtended === "advanced"
                            ? advancedGas.priorityFeeGwei
                            : gasRec.settings.priorityFeeGwei}{" "}
                          gwei
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-graphite-400">Est. gas units</span>
                        <span className="font-mono">
                          {gasModeExtended === "advanced"
                            ? advancedGas.gasLimitUnits.toLocaleString()
                            : gasRec.estimatedGasUnits.toLocaleString()}
                        </span>
                      </div>
                      <div className="my-1 border-t border-graphite-700" />
                      <div className="flex justify-between font-medium text-graphite-100">
                        <span>Est. cost / wallet</span>
                        <span className="font-mono text-orange-300">
                          ~{gasCostPerWallet.toFixed(5)} ETH
                        </span>
                      </div>
                      <div className="flex justify-between text-graphite-400">
                        <span>Max cap / wallet</span>
                        <span className="font-mono">
                          {gasModeExtended === "advanced"
                            ? advancedGas.maxTotalGasCostEth.toFixed(5)
                            : gasRec.settings.maxTotalGasCostEth.toFixed(5)}{" "}
                          ETH
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-graphite-500">Unable to estimate gas.</p>
                  )}
                </div>
              </div>
            </Panel>

            {/* ── Instant Flipper ── */}
            <Panel>
              <button
                type="button"
                className="flex w-full items-center justify-between p-4"
                onClick={() => setFlipperOpen((o) => !o)}
              >
                <div className="flex items-center gap-3">
                  <div className={`grid size-8 place-items-center rounded-md ${flipperEnabled ? "bg-brand/20" : "bg-graphite-800"}`}>
                    <Repeat2 size={15} className={flipperEnabled ? "text-brand" : "text-graphite-400"} />
                  </div>
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-semibold text-graphite-100">Instant Flipper</p>
                      {flipperEnabled && (
                        <Badge tone="green">{flipperMode === "auto" ? "Auto" : "Manual"}</Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-graphite-500">
                      Auto-list minted NFTs on OpenSea after mint.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setFlipperEnabled((v) => !v); if (!flipperOpen) setFlipperOpen(true); }}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${flipperEnabled ? "bg-brand" : "bg-graphite-600"}`}
                  >
                    <span className={`inline-block size-3.5 rounded-full bg-white shadow transition-transform ${flipperEnabled ? "translate-x-4" : "translate-x-1"}`} />
                  </button>
                  {flipperOpen ? <ChevronUp size={14} className="text-graphite-400" /> : <ChevronDown size={14} className="text-graphite-400" />}
                </div>
              </button>

              {flipperOpen && (
                <div className="border-t border-graphite-700 px-4 pb-4 pt-4 space-y-3">
                  {/* Mode */}
                  <label>
                    <span className="mb-1 block text-[11px] font-medium text-graphite-400">Flip Mode</span>
                    <Select value={flipperMode} onChange={(e) => setFlipperMode(e.target.value as "auto" | "manual")}>
                      <option value="auto">Auto — list immediately after mint confirms</option>
                      <option value="manual">Manual — I'll trigger the flip myself</option>
                    </Select>
                  </label>

                  {/* Price mode */}
                  <label>
                    <span className="mb-1 block text-[11px] font-medium text-graphite-400">Price Mode</span>
                    <Select value={flipperPriceMode} onChange={(e) => setFlipperPriceMode(e.target.value as "floor_percent" | "fixed")}>
                      <option value="floor_percent">Floor % — list at X% of current floor</option>
                      <option value="fixed">Fixed — set exact ETH price</option>
                    </Select>
                  </label>

                  {/* Floor multiplier or fixed price */}
                  {flipperPriceMode === "floor_percent" ? (
                    <label>
                      <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                        Floor Multiplier <span className="text-graphite-500">(e.g. 0.98 = 98% of floor)</span>
                      </span>
                      <Input
                        type="number" min="0.1" max="5" step="any"
                        value={flipperMultiplier}
                        onChange={(e) => setFlipperMultiplier(e.target.value)}
                        placeholder="0.98"
                      />
                    </label>
                  ) : (
                    <label>
                      <span className="mb-1 block text-[11px] font-medium text-graphite-400">Fixed Price (ETH)</span>
                      <Input
                        type="number" min="0.0001" step="any"
                        value={flipperFixedPrice}
                        onChange={(e) => setFlipperFixedPrice(e.target.value)}
                        placeholder="e.g. 0.05"
                      />
                    </label>
                  )}

                  <div className="grid gap-3 md:grid-cols-2">
                    <label>
                      <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                        Min Price (ETH) <span className="text-graphite-500">(optional)</span>
                      </span>
                      <Input
                        type="number" min="0" step="any"
                        value={flipperMinPrice}
                        onChange={(e) => setFlipperMinPrice(e.target.value)}
                        placeholder="e.g. 0.01"
                      />
                    </label>
                    <label>
                      <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                        Max Qty per Wallet
                      </span>
                      <Input
                        type="number" min="1" step="1"
                        value={flipperMaxPerWallet}
                        onChange={(e) => setFlipperMaxPerWallet(e.target.value)}
                        placeholder="1"
                      />
                    </label>
                  </div>

                  {flipperEnabled && (
                    <div className="rounded-md border border-brand/20 bg-brand/5 px-3 py-2 text-[11px] text-brand">
                      {flipperMode === "auto"
                        ? `After mint: auto-list up to ${flipperMaxPerWallet} NFT(s)/wallet at ${flipperPriceMode === "floor_percent" ? `${Number(flipperMultiplier) * 100}% of floor` : `${flipperFixedPrice || "—"} ETH`}${flipperMinPrice ? ` (min ${flipperMinPrice} ETH)` : ""}.`
                        : `Manual mode: use "Flip Now" button in Mint Tasks after mint completes.`}
                    </div>
                  )}
                </div>
              )}
            </Panel>

            {/* ── Priority Mode ── */}
            <Panel>
              <button
                type="button"
                className="flex w-full items-center justify-between p-4"
                onClick={() => setPriorityModeOpen((o) => !o)}
              >
                <div className="flex items-center gap-3">
                  <div className={`grid size-8 place-items-center rounded-md ${priorityModeEnabled ? "bg-brand/20" : "bg-graphite-800"}`}>
                    <Shield size={15} className={priorityModeEnabled ? "text-brand" : "text-graphite-400"} />
                  </div>
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-semibold text-graphite-100">Priority Mode</p>
                      {priorityModeEnabled && <Badge tone="green">Active</Badge>}
                    </div>
                    <p className="text-[11px] text-graphite-500">
                      Keep your top wallets when supply runs out.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPriorityModeEnabled((v) => !v);
                      if (!priorityModeOpen) setPriorityModeOpen(true);
                    }}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${priorityModeEnabled ? "bg-brand" : "bg-graphite-600"}`}
                  >
                    <span className={`inline-block size-3.5 rounded-full bg-white shadow transition-transform ${priorityModeEnabled ? "translate-x-4" : "translate-x-1"}`} />
                  </button>
                  {priorityModeOpen ? <ChevronUp size={14} className="text-graphite-400" /> : <ChevronDown size={14} className="text-graphite-400" />}
                </div>
              </button>

              {priorityModeOpen && (
                <div className="border-t border-graphite-700 px-4 pb-4 pt-4 space-y-4">
                  {/* Info banner */}
                  <div className="rounded-md border border-graphite-700 bg-graphite-800/50 px-3 py-2.5 text-[11px] text-graphite-400 leading-relaxed">
                    When mint supply is tight and pending transactions exceed available supply, the bot cancels excess transactions.
                    Priority Mode ensures your <span className="text-graphite-200 font-medium">top-ranked wallets</span> are always kept — lower-ranked ones get cancelled first.
                  </div>

                  {/* Max transactions */}
                  <label>
                    <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                      Max transactions{" "}
                      <span className="text-graphite-500 font-normal">
                        (limit how many wallets mint — others cancelled if supply tight)
                      </span>
                    </span>
                    <Input
                      type="number"
                      min="1"
                      max={selectedWalletIds.length || 50}
                      value={priorityMaxTx}
                      onChange={(e) => setPriorityMaxTx(e.target.value)}
                      placeholder={`e.g. ${Math.max(1, Math.ceil(selectedWalletIds.length / 2))} of ${selectedWalletIds.length || "?"} wallets`}
                    />
                  </label>

                  {/* Supply buffer */}
                  <label>
                    <span className="mb-1 block text-[11px] font-medium text-graphite-400">
                      Supply buffer{" "}
                      <span className="text-graphite-500 font-normal">(optional — cancel if remaining supply drops below this number)</span>
                    </span>
                    <Input
                      type="number"
                      min="0"
                      value={prioritySupplyBuffer}
                      onChange={(e) => setPrioritySupplyBuffer(e.target.value)}
                      placeholder="e.g. 5"
                    />
                  </label>

                  {/* Wallet priority ranking */}
                  {priorityWalletOrder.length > 0 && (
                    <div>
                      <p className="mb-2 text-[11px] font-medium text-graphite-400">
                        Wallet priority order{" "}
                        <span className="text-graphite-500 font-normal">— use arrows to rank (top = kept first)</span>
                      </p>
                      <div className="space-y-1.5">
                        {priorityWalletOrder.map((walletId, index) => {
                          const wallet = wallets.find((w) => w.id === walletId);
                          if (!wallet) return null;
                          return (
                            <div
                              key={walletId}
                              className="flex items-center gap-2 rounded-md border border-graphite-700 bg-graphite-800 px-3 py-2"
                            >
                              <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${
                                index === 0 ? "bg-brand text-white" : "bg-graphite-700 text-graphite-400"
                              }`}>
                                {index + 1}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="truncate text-[12px] font-medium text-graphite-100">{wallet.name}</p>
                                <p className="font-mono text-[10px] text-graphite-500">{wallet.address.slice(0, 10)}…</p>
                              </div>
                              <div className="flex gap-1 shrink-0">
                                <button
                                  type="button"
                                  disabled={index === 0}
                                  onClick={() => {
                                    setPriorityWalletOrder((prev) => {
                                      const next = [...prev];
                                      [next[index - 1], next[index]] = [next[index], next[index - 1]];
                                      return next;
                                    });
                                  }}
                                  className="rounded p-1 text-graphite-500 hover:text-graphite-200 disabled:opacity-25 transition-colors"
                                  aria-label="Move up"
                                >
                                  <ChevronUp size={13} />
                                </button>
                                <button
                                  type="button"
                                  disabled={index === priorityWalletOrder.length - 1}
                                  onClick={() => {
                                    setPriorityWalletOrder((prev) => {
                                      const next = [...prev];
                                      [next[index + 1], next[index]] = [next[index], next[index + 1]];
                                      return next;
                                    });
                                  }}
                                  className="rounded p-1 text-graphite-500 hover:text-graphite-200 disabled:opacity-25 transition-colors"
                                  aria-label="Move down"
                                >
                                  <ChevronDown size={13} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-[10px] text-graphite-600">
                        Select wallets in the wallet panel to add them here.
                      </p>
                    </div>
                  )}

                  {priorityWalletOrder.length === 0 && (
                    <div className="notice text-[11px] text-graphite-500">
                      Select wallets above — they&apos;ll appear here for ranking.
                    </div>
                  )}

                  {priorityModeEnabled && priorityMaxTx && (
                    <div className="rounded-md border border-brand/20 bg-brand/5 px-3 py-2 text-[11px] text-brand">
                      Top {priorityMaxTx} wallet(s) will be kept if supply gets tight.
                      {prioritySupplyBuffer ? ` Cancelling when supply drops below ${prioritySupplyBuffer}.` : ""}
                    </div>
                  )}
                </div>
              )}
            </Panel>

            {/* ── Readiness + Cost Summary ── */}
            <Panel>
              <div className="panel-header">
                <p className="text-[14px] font-semibold text-graphite-100">Readiness</p>
                <Badge tone={canCreate ? "green" : "yellow"}>
                  {canCreate ? "Ready" : "Needs input"}
                </Badge>
              </div>
              <div className="space-y-3 p-5 text-[13px] text-graphite-400">
                <p className="flex items-center gap-2">
                  <CheckCircle2
                    size={14}
                    className={collection ? "text-status-green-text" : "text-graphite-600"}
                  />
                  Scanned collection selected
                </p>
                <p className="flex items-center gap-2">
                  <CheckCircle2
                    size={14}
                    className={selectedWalletIds.length > 0 ? "text-status-green-text" : "text-graphite-600"}
                  />
                  At least one wallet selected
                </p>
                <p className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-status-green-text" />
                  Gas profile selected
                </p>

                {/* ── Cost summary / worth-it ── */}
                {collection && selectedPhase && (
                  <div className="mt-1 rounded-md border border-graphite-700 bg-graphite-800/50 px-3 py-3 text-[12px]">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-graphite-400">
                      Cost Summary
                    </p>
                    <div className="space-y-1.5 text-graphite-300">
                      <div className="flex justify-between">
                        <span className="text-graphite-400">Mint price × {qty}</span>
                        <span className="font-mono">{(mintPriceEth * qty).toFixed(4)} ETH</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-graphite-400">Gas est. × {qty}</span>
                        <span className="font-mono">
                          {gasRec ? `~${(gasCostPerWallet * qty).toFixed(5)} ETH` : "—"}
                        </span>
                      </div>
                      <div className="my-1 border-t border-graphite-700" />
                      <div className="flex justify-between font-medium text-graphite-100">
                        <span>Total / wallet</span>
                        <span className="font-mono">
                          {gasRec
                            ? `~${totalCostPerWallet.toFixed(5)} ETH`
                            : `${(mintPriceEth * qty).toFixed(4)} ETH`}
                        </span>
                      </div>
                      {selectedWalletIds.length > 1 && (
                        <div className="flex justify-between font-semibold text-white">
                          <span>Grand total ({selectedWalletIds.length} wallets)</span>
                          <span className="font-mono text-brand">
                            {gasRec
                              ? `~${grandTotal.toFixed(5)} ETH`
                              : `${(mintPriceEth * qty * selectedWalletIds.length).toFixed(4)} ETH`}
                          </span>
                        </div>
                      )}

                      {/* Worth-it signal */}
                      {gasRec && mintPriceEth > 0 && (
                        <div className="mt-2 rounded border border-graphite-700 bg-graphite-800 px-2 py-1.5 text-[11px]">
                          {gasCostPerWallet > mintPriceEth * 0.5 ? (
                            <span className="flex items-center gap-1 text-amber-400">
                              <AlertTriangle size={11} />
                              Gas is {((gasCostPerWallet / mintPriceEth) * 100).toFixed(0)}% of mint price — high relative cost.
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-status-green-text">
                              <CheckCircle2 size={11} />
                              Gas is {((gasCostPerWallet / mintPriceEth) * 100).toFixed(0)}% of mint price — reasonable.
                            </span>
                          )}
                        </div>
                      )}
                      {gasRec && mintPriceEth === 0 && gasCostPerWallet > 0 && (
                        <div className="mt-2 rounded border border-graphite-700 bg-graphite-800 px-2 py-1.5 text-[11px]">
                          <span className="flex items-center gap-1 text-graphite-300">
                            <Flame size={11} className="text-orange-400" />
                            Free mint — total cost is gas only (~{gasCostPerWallet.toFixed(5)} ETH/wallet).
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {message && <p className="notice text-[12px]">{message}</p>}

                <Button className="w-full" disabled={!canCreate || createTask.isPending}>
                  {createTask.isPending ? "Creating..." : "Create Mint Task"}
                </Button>
              </div>
            </Panel>
          </div>
        </div>
      </form>

      {/* Advanced Gas Modal */}
      <AdvancedGasModal
        open={gasModalOpen}
        onClose={() => setGasModalOpen(false)}
        onSave={handleModalSave}
        initial={{
          currency: advancedGas.gasBudgetCurrency,
          budget: advancedGas.gasBudget,
          spendingMode: advancedGas.spendingMode,
          gasLimit: advancedGas.gasLimitUnits,
        }}
        ethUsdPrice={ethUsdPrice ?? null}
        liveBaseGwei={gasRec?.liveBaseGwei ?? null}
        phaseLabel={`${phaseType} STAGE`}
        suggestedGasLimit={gasSim?.simulated ? gasSim.recommendedLimit : undefined}
      />
    </AppShell>
  );
}
