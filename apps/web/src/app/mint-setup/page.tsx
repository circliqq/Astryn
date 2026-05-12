"use client";

import { Suspense, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  ExternalLink,
  Flame,
  Repeat2,
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
  const searchParams = useSearchParams();
  const collectionId = searchParams.get("collectionId") ?? "";

  const [phaseType, setPhaseType] = useState<CollectionPhase["phaseType"]>("PUBLIC");
  const [selectedWalletIds, setSelectedWalletIds] = useState<string[]>([]);
  const [gasModeExtended, setGasModeExtended] = useState<ExtendedGasMode>(() => loadSavedGasSettings().mode);
  const [advancedGas, setAdvancedGas] = useState<Pick<GasSettings, "maxFeeGwei" | "priorityFeeGwei" | "maxTotalGasCostEth" | "maxBumpAttempts">>({
    maxFeeGwei: 50,
    priorityFeeGwei: 2,
    maxTotalGasCostEth: 0.005,
    maxBumpAttempts: 3,
  });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mintQuantity, setMintQuantity] = useState("1");
  const [scheduleMode, setScheduleMode] = useState<"draft" | "phase_start" | "custom">("draft");
  const [scheduleAt, setScheduleAt] = useState("");
  const [message, setMessage] = useState<string | null>(null);

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

  const selectedPhase =
    collection?.phases.find((p) => p.phaseType === phaseType) ??
    collection?.phases[0] ??
    null;

  const eligibility = phaseEligibility(selectedPhase?.phaseType ?? "PUBLIC");

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
          maxTotalGasCostEth: advancedGas.maxTotalGasCostEth,
          gasBumpEnabled: true,
          maxBumpAttempts: advancedGas.maxBumpAttempts,
        }
      : GAS_PRESETS[gasMode];

  const qty = Math.max(1, Number.parseInt(mintQuantity, 10) || 1);
  const mintPriceEth = selectedPhase ? weiToEth(selectedPhase.priceWei) : 0;
  const gasCostPerWallet = gasRec?.estimatedGasCostEth ?? 0;
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
          scheduleMode: scheduleMode === "phase_start" ? "phase_start" : "draft",
          scheduleAt:
            scheduleMode === "custom" && scheduleAt
              ? new Date(scheduleAt).toISOString()
              : undefined,
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
                        <div className="mt-2 flex items-center gap-1.5">
                          {eligibility.isVerified ? (
                            <CheckCircle2 size={11} className="text-status-green-text" />
                          ) : (
                            <AlertTriangle size={11} className="text-amber-400" />
                          )}
                          <span
                            className={`text-[10px] font-medium ${
                              eligibility.isVerified ? "text-status-green-text" : "text-amber-400"
                            }`}
                          >
                            {eligibility.label}
                          </span>
                        </div>
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
                    {(["PUBLIC", "ALLOWLIST", "GTD", "FCFS"] as const).map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
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
                        <div className="grid gap-3 border-t border-graphite-700 px-3 pb-3 pt-3 md:grid-cols-2">
                          <label>
                            <span className="mb-1 block text-[10px] font-medium text-graphite-400">
                              Max fee (gwei)
                            </span>
                            <Input
                              type="number"
                              min="1"
                              step="0.1"
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
                              step="0.1"
                              value={advancedGas.priorityFeeGwei}
                              onChange={(e) =>
                                setAdvancedGas((g) => ({ ...g, priorityFeeGwei: Number(e.target.value) }))
                              }
                            />
                          </label>
                          <label>
                            <span className="mb-1 block text-[10px] font-medium text-graphite-400">
                              Gas cap (ETH)
                            </span>
                            <Input
                              type="number"
                              min="0"
                              step="0.0001"
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
                    ? `Phase starts ${new Date(selectedPhase.startTime).toLocaleString()}.`
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
                          {gasRec.estimatedGasUnits.toLocaleString()}
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
                        type="number" min="0.1" max="5" step="0.01"
                        value={flipperMultiplier}
                        onChange={(e) => setFlipperMultiplier(e.target.value)}
                        placeholder="0.98"
                      />
                    </label>
                  ) : (
                    <label>
                      <span className="mb-1 block text-[11px] font-medium text-graphite-400">Fixed Price (ETH)</span>
                      <Input
                        type="number" min="0.0001" step="0.001"
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
                        type="number" min="0" step="0.001"
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
