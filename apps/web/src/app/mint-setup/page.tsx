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
  ClipboardList,
  DollarSign,
  ExternalLink,
  Flame,
  Gauge,
  Repeat2,
  WalletCards,
  Wallet,
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
  phaseType: "PUBLIC" | "ALLOWLIST" | "GTD" | "FCFS";
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

function phaseEligibility(phaseType: CollectionPhase["phaseType"]): {
  label: string;
  tone: "green" | "yellow" | "slate";
  isVerified: boolean;
} {
  if (phaseType === "PUBLIC") return { label: "Eligible", tone: "green", isVerified: true };
  if (phaseType === "FCFS") return { label: "FCFS – Verify WL", tone: "yellow", isVerified: false };
  if (phaseType === "GTD") return { label: "GTD – Verify WL", tone: "yellow", isVerified: false };
  return { label: "WL Required", tone: "yellow", isVerified: false };
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

  const [phaseType, setPhaseType] = useState<CollectionPhase["phaseType"]>("PUBLIC");
  const [selectedWalletIds, setSelectedWalletIds] = useState<string[]>([]);
  const [gasModeExtended, setGasModeExtended] = useState<ExtendedGasMode>(() => loadSavedGasSettings().mode);
  const [advancedGas, setAdvancedGas] = useState<Pick<GasSettings, "maxFeeGwei" | "priorityFeeGwei" | "maxTotalGasCostEth" | "maxBumpAttempts"> & { gasLimitUnits: number; gasBudget: string; gasBudgetCurrency: "ETH" | "USD" }>({
    maxFeeGwei: 50,
    priorityFeeGwei: 2,
    maxTotalGasCostEth: 0.005,
    maxBumpAttempts: 3,
    gasLimitUnits: DEFAULT_MINT_GAS_UNITS,
    gasBudget: "",
    gasBudgetCurrency: "ETH",
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);

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

  // ── Per-wallet eligibility ────────────────────────────────────────────────
  // null = checking, true = eligible, false = not eligible, "unverifiable" = API can't check
  const [walletEligibilityMap, setWalletEligibilityMap] = useState<Map<string, boolean | "unverifiable" | null>>(new Map());
  const [isCheckingEligibility, setIsCheckingEligibility] = useState(false);
  // Manual overrides: wallets the user has confirmed eligible on OpenSea
  const [manualEligibleMap, setManualEligibleMap] = useState<Set<string>>(new Set());
  // Global eligibility confirmation for unverifiable collections
  const [eligibilityConfirmed, setEligibilityConfirmed] = useState(false);

  // ── Instant Flipper state ─────────────────────────────────────────────────
  const [flipperEnabled, setFlipperEnabled]         = useState(false);
  const [flipperOpen, setFlipperOpen]               = useState(false);
  const [flipperMode, setFlipperMode]               = useState<"auto" | "manual">("auto");
  const [flipperPriceMode, setFlipperPriceMode]     = useState<"floor_percent" | "fixed">("floor_percent");
  const [flipperMultiplier, setFlipperMultiplier]   = useState("0.98");
  const [flipperFixedPrice, setFlipperFixedPrice]   = useState("");
  const [flipperMinPrice, setFlipperMinPrice]       = useState("");
  const [flipperMaxPerWallet, setFlipperMaxPerWallet] = useState("1");

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

  // ── Derived values ────────────────────────────────────────────────────────────

  const compatibleWallets = useMemo(() => {
    if (!collection) return wallets;
    return wallets.filter((w) => w.network === collection.chain);
  }, [collection, wallets]);

  // Resolve the correct phase record for each logical type.
  // Since OpenSea's API returns GTD/FCFS/Support all as "allowlist" type, they are stored
  // as multiple ALLOWLIST phases with different start times, ordered chronologically.
  // Mapping: GTD → 1st allowlist, FCFS → 2nd allowlist, ALLOWLIST → last allowlist, PUBLIC → public.
  const selectedPhase = useMemo(() => {
    if (!collection) return null;

    // Direct match first (works if phases were correctly stored with GTD/FCFS types)
    const direct = collection.phases.find((p) => p.phaseType === phaseType);
    if (direct) return direct;

    // Collect all "allowlist family" phases sorted by start time
    const allowlistFamily = [...collection.phases]
      .filter((p) => p.phaseType === "ALLOWLIST" || p.phaseType === "GTD" || p.phaseType === "FCFS")
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    if (phaseType === "GTD")       return allowlistFamily[0] ?? null;
    if (phaseType === "FCFS")      return allowlistFamily[1] ?? allowlistFamily[0] ?? null;
    if (phaseType === "ALLOWLIST") return allowlistFamily[allowlistFamily.length - 1] ?? allowlistFamily[0] ?? null;

    return collection.phases[0] ?? null;
  }, [collection, phaseType]);

  const eligibility = phaseEligibility(selectedPhase?.phaseType ?? "PUBLIC");

  // Reset confirmation when phase changes
  useEffect(() => { setEligibilityConfirmed(false); }, [collectionId, phaseType]);

  // ── Auto per-wallet eligibility check when phase/collection changes ───────
  useEffect(() => {
    if (!collection || !collectionId || compatibleWallets.length === 0) return;
    if (phaseType === "PUBLIC") {
      setWalletEligibilityMap(new Map(compatibleWallets.map((w) => [w.id, true])));
      return;
    }
    setIsCheckingEligibility(true);
    setWalletEligibilityMap(new Map(compatibleWallets.map((w) => [w.id, null])));
    apiFetch<{ wallets: Array<{ walletId: string; eligiblePhaseTypes: string[]; unverifiablePhaseTypes?: string[] }> }>(
      `/collections/${collectionId}/eligibility-matrix`,
      { method: "POST", body: JSON.stringify({ walletIds: compatibleWallets.map((w) => w.id) }) }
    )
      .then((data) => {
        const map = new Map<string, boolean | "unverifiable">();
        for (const w of data.wallets) {
          if (w.eligiblePhaseTypes.includes(phaseType)) {
            map.set(w.walletId, true);
          } else if (w.unverifiablePhaseTypes?.includes(phaseType)) {
            // OpenSea returned 404 — can't confirm either way
            map.set(w.walletId, "unverifiable");
          } else {
            map.set(w.walletId, false);
          }
        }
        setWalletEligibilityMap(map);
      })
      .catch(() => {
        // On error keep map as-is (null = unknown)
      })
      .finally(() => setIsCheckingEligibility(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, collectionId, phaseType]);

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

  const qty = Math.max(1, Number.parseInt(mintQuantity, 10) || 1);
  const mintPriceEth = selectedPhase ? weiToEth(selectedPhase.priceWei) : 0;
  // Budget in ETH (convert from USD if needed)
  const gasBudgetEth = (() => {
    const raw = Number(advancedGas.gasBudget);
    if (!raw || raw <= 0) return 0;
    if (advancedGas.gasBudgetCurrency === "USD") {
      return ethUsdPrice && ethUsdPrice > 0 ? raw / ethUsdPrice : 0;
    }
    return raw;
  })();

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

  // Whether any selected wallet has unverified eligibility for a non-public phase
  const hasUnverifiedWallets =
    phaseType !== "PUBLIC" &&
    selectedWalletIds.some((id) => {
      const elig = walletEligibilityMap.get(id);
      return elig !== true; // not confirmed eligible by API
    });

  const canCreate = Boolean(
    collection &&
    selectedWalletIds.length > 0 &&
    (!hasUnverifiedWallets || eligibilityConfirmed)
  );

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
            {/* ── Collection panel ── */}
            <Panel>
              <div className="panel-header">
                <div>
                  <p className="text-[14px] font-semibold text-graphite-100">Collection</p>
                  <p className="mt-0.5 text-[12px] text-graphite-500">Start from a scanned OpenSea drop.</p>
                </div>
                <ClipboardList size={17} className="text-graphite-500" />
              </div>
              {collectionLoading ? (
                <div className="empty-state">Loading collection...</div>
              ) : collection ? (
                <div className="grid gap-5 p-5 md:grid-cols-[96px_1fr]">
                  <div className="aspect-square overflow-hidden rounded-md border border-graphite-700 bg-graphite-800">
                    {collection.imageUrl ? (
                      <img src={collection.imageUrl} alt={collection.name} className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[18px] font-semibold text-graphite-100">{collection.name}</h2>
                      <Badge tone="blue">{collection.chain === "BASE" ? "Base" : "Ethereum"}</Badge>
                    </div>
                    <p className="mt-2 font-mono text-[12px] text-graphite-500">{collection.contractAddress}</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div>
                        <p className="label-caps">Slug</p>
                        <p className="mt-1 text-graphite-200">{collection.slug}</p>
                      </div>
                      <div>
                        <p className="label-caps">Phase</p>
                        <p className="mt-1 text-graphite-200">{selectedPhase?.phaseType ?? "-"}</p>
                      </div>
                      <div>
                        <p className="label-caps">Price</p>
                        <p className="mt-1 text-graphite-200">
                          {selectedPhase ? formatEth(selectedPhase.priceWei) : "-"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <div>
                    <p className="font-medium text-graphite-200">No scanned collection selected.</p>
                    <Button type="button" className="mt-4" onClick={() => router.push("/scanner")}>
                      Open Scanner
                    </Button>
                  </div>
                </div>
              )}
            </Panel>

            {/* ── Wallet selection ── */}
            <Panel>
              <div className="panel-header">
                <div>
                  <p className="text-[14px] font-semibold text-graphite-100">Wallet Selection</p>
                  <p className="mt-0.5 text-[12px] text-graphite-500">
                    Only matching-network wallets are shown.
                    {selectedPhase && selectedPhase.phaseType !== "PUBLIC" && (
                      <span className="ml-1 text-amber-400">
                        {selectedPhase.phaseType} phase — verify whitelist eligibility.
                      </span>
                    )}
                  </p>
                </div>
                <WalletCards size={17} className="text-graphite-500" />
              </div>

              {/* WL warning banner for non-public phases */}
              {selectedPhase && selectedPhase.phaseType !== "PUBLIC" && (
                <div className="mx-5 mt-3 flex items-start gap-2 rounded-md border border-amber-800/40 bg-amber-950/30 px-3 py-2.5 text-[12px] text-amber-300">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>
                    <strong>{selectedPhase.phaseType}</strong> phase requires whitelist access. Wallets below need to be verified before minting.{" "}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-amber-100"
                      onClick={() => router.push("/whitelist-checker")}
                    >
                      Check eligibility <ExternalLink size={11} />
                    </button>
                  </span>
                </div>
              )}

              {/* Eligibility confirmation checkbox — shown when API can't verify */}
              {hasUnverifiedWallets && selectedWalletIds.length > 0 && (
                <label className="mx-5 mt-3 flex cursor-pointer items-start gap-3 rounded-md border border-graphite-600 bg-graphite-800 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={eligibilityConfirmed}
                    onChange={(e) => setEligibilityConfirmed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand"
                  />
                  <div>
                    <p className="text-[12px] font-medium text-graphite-100">
                      I've verified eligibility on OpenSea
                    </p>
                    <p className="mt-0.5 text-[11px] text-graphite-500">
                      Bot couldn't auto-verify — tick this to confirm selected wallets are eligible and unlock task creation.
                    </p>
                  </div>
                </label>
              )}

              <div className="grid gap-2 p-5 md:grid-cols-2 xl:grid-cols-3">
                {compatibleWallets.length === 0 ? (
                  <div className="notice md:col-span-2 xl:col-span-3">No compatible wallets found.</div>
                ) : (
                  compatibleWallets.map((wallet) => {
                    const selected = selectedWalletIds.includes(wallet.id);
                    return (
                      <button
                        key={wallet.id}
                        type="button"
                        className={`rounded-md border px-3 py-3 text-left transition-colors ${
                          selected
                            ? "border-brand bg-brand-bg"
                            : "border-graphite-700 bg-graphite-800 hover:border-graphite-600"
                        }`}
                        onClick={() => toggleWallet(wallet.id)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium text-graphite-100">{wallet.name}</span>
                          <Badge tone={selected ? "green" : "slate"}>
                            {selected ? "Selected" : wallet.status}
                          </Badge>
                        </div>
                        <p className="mt-1 font-mono text-[11px] text-graphite-500">
                          {wallet.address.slice(0, 12)}...
                        </p>
                        {/* Per-wallet phase eligibility indicator */}
                        {(() => {
                          const walletElig = walletEligibilityMap.get(wallet.id);
                          const isChecking = isCheckingEligibility || walletElig === null;
                          const isManuallyEligible = manualEligibleMap.has(wallet.id);
                          const isEligible = walletElig === true || isManuallyEligible;
                          const isUnverifiable = walletElig === "unverifiable" && !isManuallyEligible;
                          // undefined = map not populated yet (phase is PUBLIC or data not loaded)
                          if (walletElig === undefined) return null;
                          return (
                            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                              {isChecking ? (
                                <span className="text-[10px] font-medium text-graphite-500">Checking...</span>
                              ) : isEligible ? (
                                <>
                                  <CheckCircle2 size={11} className="text-status-green-text" />
                                  <span className="text-[10px] font-medium text-status-green-text">
                                    {isManuallyEligible && walletElig !== true ? "Eligible (manual)" : "Eligible"}
                                  </span>
                                  {isManuallyEligible && walletElig !== true && (
                                    <button
                                      className="text-[10px] text-graphite-500 underline ml-1"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setManualEligibleMap((prev) => {
                                          const next = new Set(prev);
                                          next.delete(wallet.id);
                                          return next;
                                        });
                                      }}
                                    >
                                      undo
                                    </button>
                                  )}
                                </>
                              ) : isUnverifiable ? (
                                <>
                                  <AlertTriangle size={11} className="text-amber-400" />
                                  <span className="text-[10px] font-medium text-amber-400">Unverifiable</span>
                                  <button
                                    className="text-[10px] font-medium text-graphite-400 underline ml-1"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setManualEligibleMap((prev) => new Set([...prev, wallet.id]));
                                    }}
                                  >
                                    Mark eligible
                                  </button>
                                </>
                              ) : (
                                <>
                                  <AlertTriangle size={11} className="text-red-400" />
                                  <span className="text-[10px] font-medium text-red-400">Not Eligible</span>
                                </>
                              )}
                            </div>
                          );
                        })()}
                      </button>
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
                    value={phaseType}
                    onChange={(e) => setPhaseType(e.target.value as CollectionPhase["phaseType"])}
                  >
                    <option value="GTD">GTD</option>
                    <option value="FCFS">FCFS</option>
                    <option value="ALLOWLIST">ALLOWLIST</option>
                    <option value="PUBLIC">PUBLIC</option>
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

                {/* Gas mode + Advanced */}
                <div>
                  <label>
                    <span className="mb-1 block text-[11px] font-medium text-graphite-400">Gas mode</span>
                    <Select
                      value={gasModeExtended}
                      onChange={(e) => {
                        const val = e.target.value as ExtendedGasMode;
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

                  {/* Advanced gas fields */}
                  {gasModeExtended === "advanced" && (
                    <div className="mt-3 rounded-md border border-graphite-700 bg-graphite-800/60">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-2 text-[12px] font-medium text-graphite-300 hover:text-graphite-100"
                        onClick={() => setAdvancedOpen((o) => !o)}
                      >
                        <span className="flex items-center gap-1.5">
                          <Zap size={12} className="text-brand" />
                          Custom gas parameters
                        </span>
                        {advancedOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>
                      {advancedOpen && (
                        <div className="border-t border-graphite-700 px-3 pb-3 pt-3 space-y-3">
                          {/* Row 1: Max fee + Priority fee */}
                          <div className="grid gap-3 md:grid-cols-2">
                            <label>
                              <span className="mb-1 block text-[10px] font-medium text-graphite-400">
                                Max fee (gwei)
                              </span>
                              <Input
                                type="number"
                                min="1"
                                step="any"
                                value={advancedGas.maxFeeGwei}
                                onChange={(e) =>
                                  setAdvancedGas((g) => ({ ...g, maxFeeGwei: Number(e.target.value) }))
                                }
                              />
                            </label>
                            <label>
                              <span className="mb-1 block text-[10px] font-medium text-graphite-400">
                                Priority fee (gwei)
                              </span>
                              <Input
                                type="number"
                                min="0"
                                step="any"
                                value={advancedGas.priorityFeeGwei}
                                onChange={(e) =>
                                  setAdvancedGas((g) => ({ ...g, priorityFeeGwei: Number(e.target.value) }))
                                }
                              />
                            </label>
                          </div>

                          {/* Row 2: Gas cap + Max bump */}
                          <div className="grid gap-3 md:grid-cols-2">
                            <label>
                              <span className="mb-1 block text-[10px] font-medium text-graphite-400">
                                Gas cap / wallet (ETH)
                              </span>
                              <Input
                                type="number"
                                min="0"
                                step="any"
                                value={advancedGas.maxTotalGasCostEth}
                                onChange={(e) =>
                                  setAdvancedGas((g) => ({
                                    ...g,
                                    maxTotalGasCostEth: Number(e.target.value),
                                  }))
                                }
                              />
                            </label>
                            <label>
                              <span className="mb-1 block text-[10px] font-medium text-graphite-400">
                                Max bump attempts
                              </span>
                              <Input
                                type="number"
                                min="0"
                                max="10"
                                value={advancedGas.maxBumpAttempts}
                                onChange={(e) =>
                                  setAdvancedGas((g) => ({
                                    ...g,
                                    maxBumpAttempts: Math.max(0, Number(e.target.value)),
                                  }))
                                }
                              />
                            </label>
                          </div>

                          {/* Row 3: Gas limit (units) */}
                          <label>
                            <span className="mb-1 flex items-center gap-1 text-[10px] font-medium text-graphite-400">
                              <Gauge size={10} className="text-graphite-500" />
                              Gas limit (units)
                              <span className="text-graphite-600 font-normal">— max execution units per tx</span>
                            </span>
                            <Input
                              type="number"
                              min="21000"
                              step="1000"
                              value={advancedGas.gasLimitUnits}
                              onChange={(e) =>
                                setAdvancedGas((g) => ({
                                  ...g,
                                  gasLimitUnits: Math.max(21_000, Number(e.target.value) || DEFAULT_MINT_GAS_UNITS),
                                }))
                              }
                            />
                          </label>

                          {/* Row 4: Gas Budget with ETH/USD toggle */}
                          <div>
                            <span className="mb-1 flex items-center gap-1 text-[10px] font-medium text-graphite-400">
                              <Wallet size={10} className="text-graphite-500" />
                              Gas budget
                              <span className="text-graphite-600 font-normal">— total spend cap across all wallets</span>
                            </span>
                            <div className="flex gap-2">
                              {/* Currency toggle */}
                              <div className="flex rounded-md border border-graphite-600 overflow-hidden text-[10px] font-semibold shrink-0">
                                <button
                                  type="button"
                                  onClick={() => setAdvancedGas((g) => ({ ...g, gasBudgetCurrency: "ETH" }))}
                                  className={`px-2.5 py-1.5 transition-colors ${
                                    advancedGas.gasBudgetCurrency === "ETH"
                                      ? "bg-brand text-white"
                                      : "bg-graphite-800 text-graphite-400 hover:text-graphite-200"
                                  }`}
                                >
                                  ETH
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setAdvancedGas((g) => ({ ...g, gasBudgetCurrency: "USD" }))}
                                  className={`px-2.5 py-1.5 transition-colors border-l border-graphite-600 ${
                                    advancedGas.gasBudgetCurrency === "USD"
                                      ? "bg-brand text-white"
                                      : "bg-graphite-800 text-graphite-400 hover:text-graphite-200"
                                  }`}
                                >
                                  <DollarSign size={10} className="inline -mt-px" />USD
                                </button>
                              </div>
                              <div className="relative flex-1">
                                <Input
                                  type="number"
                                  min="0"
                                  step="any"
                                  placeholder={advancedGas.gasBudgetCurrency === "ETH" ? "e.g. 0.05" : "e.g. 20"}
                                  value={advancedGas.gasBudget}
                                  onChange={(e) => setAdvancedGas((g) => ({ ...g, gasBudget: e.target.value }))}
                                  className="pr-14"
                                />
                                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-graphite-500">
                                  {advancedGas.gasBudgetCurrency === "USD" && ethUsdPrice
                                    ? `≈ ${advancedGas.gasBudget && ethUsdPrice ? (Number(advancedGas.gasBudget) / ethUsdPrice).toFixed(5) : "—"} ETH`
                                    : advancedGas.gasBudgetCurrency === "ETH" && ethUsdPrice && advancedGas.gasBudget
                                    ? `≈ $${(Number(advancedGas.gasBudget) * ethUsdPrice).toFixed(2)}`
                                    : ""}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* ── Spending Mode ── */}
                          {(() => {
                            const budget = gasBudgetEth;
                            const totalEstSpend = gasCostPerWallet * Math.max(1, selectedWalletIds.length) * qty;
                            const remaining = budget > 0 ? budget - totalEstSpend : null;
                            const pct = budget > 0 ? Math.min(100, (totalEstSpend / budget) * 100) : 0;
                            const budgetUsd = ethUsdPrice && budget > 0 ? budget * ethUsdPrice : null;
                            const spendUsd = ethUsdPrice && totalEstSpend > 0 ? totalEstSpend * ethUsdPrice : null;

                            return (
                              <div className="rounded-md border border-graphite-600 bg-graphite-900/60 px-3 py-2.5 text-[11px]">
                                <div className="mb-2 flex items-center gap-1.5 font-semibold uppercase tracking-wider text-graphite-400 text-[10px]">
                                  <DollarSign size={10} className="text-brand" />
                                  Spending Mode
                                </div>
                                <div className="space-y-1.5 text-graphite-300">
                                  <div className="flex justify-between">
                                    <span className="text-graphite-500">Budget</span>
                                    <span className="font-mono">
                                      {budget > 0
                                        ? `${budget.toFixed(5)} ETH${budgetUsd ? ` · $${budgetUsd.toFixed(2)}` : ""}`
                                        : <span className="text-graphite-600">Not set</span>}
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-graphite-500">Est. spend ({Math.max(1, selectedWalletIds.length)}w × {qty})</span>
                                    <span className={`font-mono ${budget > 0 && totalEstSpend > budget ? "text-red-400" : "text-graphite-200"}`}>
                                      {gasRec
                                        ? `~${totalEstSpend.toFixed(5)} ETH${spendUsd ? ` · $${spendUsd.toFixed(2)}` : ""}`
                                        : "—"}
                                    </span>
                                  </div>
                                  {remaining !== null && (
                                    <div className="flex justify-between">
                                      <span className="text-graphite-500">Remaining</span>
                                      <span className={`font-mono font-medium ${remaining < 0 ? "text-red-400" : "text-status-green-text"}`}>
                                        {remaining < 0
                                          ? `–${Math.abs(remaining).toFixed(5)} ETH over budget`
                                          : `${remaining.toFixed(5)} ETH`}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                {/* Progress bar */}
                                {budget > 0 && (
                                  <div className="mt-2.5">
                                    <div className="h-1.5 w-full rounded-full bg-graphite-700 overflow-hidden">
                                      <div
                                        className={`h-full rounded-full transition-all ${
                                          pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-400" : "bg-brand"
                                        }`}
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                    <div className="mt-1 flex justify-between text-[9px] text-graphite-600">
                                      <span>0</span>
                                      <span className={pct >= 100 ? "text-red-400" : pct >= 80 ? "text-amber-400" : "text-graphite-400"}>
                                        {pct.toFixed(0)}% of budget
                                      </span>
                                      <span>Budget</span>
                                    </div>
                                  </div>
                                )}
                                {budget <= 0 && (
                                  <p className="mt-1.5 text-[10px] text-graphite-600">Set a gas budget above to track spending.</p>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}
                </div>

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
    </AppShell>
  );
}
