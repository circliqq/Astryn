"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Search } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";

type Network = "BASE" | "ETHEREUM";
type PhaseType = "PUBLIC" | "ALLOWLIST" | "GTD" | "FCFS";
type PhaseStatus = "LIVE" | "UPCOMING" | "ENDED";

interface Wallet {
  id: string;
  name: string;
  address: string;
  network: Network;
}

interface CollectionPhase {
  phaseType: PhaseType;
  priceWei: string;
  startTime: string;
  endTime: string | null;
  maxMint: number | null;
}

interface Collection {
  id: string;
  name: string;
  slug: string;
  chain: Network;
  contractAddress: string;
  imageUrl: string | null;
  phases: CollectionPhase[];
}

interface WalletPhase {
  phaseType: PhaseType;
  startTime: string;
  endTime: string | null;
  phaseStatus: PhaseStatus;
  eligible: boolean;
  checked: boolean;
  reason: string;
}

interface WalletEligibility {
  walletId: string;
  walletName: string;
  walletAddress: string;
  eligiblePhaseTypes: PhaseType[];
  phases: WalletPhase[];
}

interface EligibilityMatrix {
  collectionId: string;
  collectionName: string;
  collectionSlug: string;
  phaseSource: "live" | "stored";
  phaseWarning: string | null;
  phaseCheckedAt: string;
  phaseWindows: Array<{
    phaseType: PhaseType;
    startTime: string;
    endTime: string | null;
    phaseStatus: PhaseStatus;
  }>;
  wallets: WalletEligibility[];
}

const PHASE_LABELS: Record<PhaseType, string> = {
  PUBLIC: "Public",
  ALLOWLIST: "Allowlist",
  GTD: "GTD",
  FCFS: "FCFS",
};

function compactAddress(address: string) {
  return `${address.slice(0, 12)}...${address.slice(-4)}`;
}

function extractContractAddress(value: string) {
  return value.match(/0x[a-fA-F0-9]{40}/)?.[0] ?? null;
}

function isOpenSeaUrl(value: string) {
  try {
    return new URL(value).hostname.endsWith("opensea.io");
  } catch {
    return false;
  }
}

function statusTone(status: PhaseStatus): "green" | "yellow" | "slate" {
  if (status === "LIVE") return "green";
  if (status === "UPCOMING") return "yellow";
  return "slate";
}

function outcomeTone(phase: WalletPhase): "green" | "yellow" | "slate" {
  if (phase.eligible) return "green";
  if (!phase.checked) return "yellow";
  return "slate";
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

export default function WhitelistCheckerPage() {
  const [collectionInput, setCollectionInput] = useState("");
  const [collection, setCollection] = useState<Collection | null>(null);
  const [selectedWalletIds, setSelectedWalletIds] = useState<string[]>([]);
  const [matrix, setMatrix] = useState<EligibilityMatrix | null>(null);
  const [ran, setRan] = useState(false);
  const [loadingCollection, setLoadingCollection] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const { data: wallets = [], isLoading } = useQuery<Wallet[]>({
    queryKey: ["wallets"],
    queryFn: () => apiFetch<Wallet[]>("/wallets"),
  });

  const selectedWallets = useMemo(
    () => wallets.filter((wallet) => selectedWalletIds.includes(wallet.id)),
    [selectedWalletIds, wallets]
  );

  const eligibleWalletCount = matrix?.wallets.filter((wallet) => wallet.eligiblePhaseTypes.length > 0).length ?? 0;
  const phaseCount = matrix?.phaseWindows.length ?? collection?.phases.length ?? 0;

  function resetCheckState() {
    setMatrix(null);
    setRan(false);
    setMessage(null);
  }

  function handleCollectionInput(value: string) {
    setCollectionInput(value);
    setCollection(null);
    resetCheckState();
  }

  function toggleWallet(id: string) {
    setSelectedWalletIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
    resetCheckState();
  }

  async function resolveCollection() {
    const input = collectionInput.trim();
    if (!input) throw new Error("Enter a collection contract address.");

    if (isOpenSeaUrl(input)) {
      return apiFetch<Collection>("/collections/scan", {
        method: "POST",
        body: JSON.stringify({ url: input }),
      });
    }

    const contractAddress = extractContractAddress(input);
    if (!contractAddress) {
      throw new Error("Enter a full 0x collection contract address.");
    }

    return apiFetch<Collection>(`/collections/by-contract/${contractAddress}`);
  }

  async function handleFindCollection() {
    setLoadingCollection(true);
    setMessage(null);
    try {
      const found = await resolveCollection();
      setCollection(found);
      setMatrix(null);
      setRan(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to find collection.");
    } finally {
      setLoadingCollection(false);
    }
  }

  async function handleRunCheck() {
    if (selectedWalletIds.length === 0) {
      setMessage("Select at least one vault wallet.");
      return;
    }

    setChecking(true);
    setMessage(null);
    setRan(false);
    try {
      const found = collection ?? (await resolveCollection());
      setCollection(found);
      const result = await apiFetch<EligibilityMatrix>(`/collections/${found.id}/eligibility-matrix`, {
        method: "POST",
        body: JSON.stringify({ walletIds: selectedWalletIds }),
      });
      setMatrix(result);
      setRan(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Eligibility check failed.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <AppShell title="Whitelist Check">
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <Panel>
          <div className="panel-header">
            <div>
              <p className="text-[14px] font-semibold text-graphite-100">Collection Input</p>
              <p className="mt-0.5 text-[12px] text-graphite-500">Check selected vault wallets against collection mint phases.</p>
            </div>
            <ClipboardCheck size={17} className="text-graphite-500" />
          </div>
          <div className="space-y-4 p-5">
            <label>
              <span className="mb-1 block text-[11px] font-medium text-graphite-400">Collection contract address</span>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={collectionInput}
                  onChange={(event) => handleCollectionInput(event.target.value)}
                  placeholder="0x... or OpenSea drop URL"
                  onKeyDown={(event) => event.key === "Enter" && handleFindCollection()}
                />
                <Button type="button" variant="secondary" onClick={handleFindCollection} disabled={loadingCollection || !collectionInput.trim()}>
                  <Search size={14} /> {loadingCollection ? "Finding" : "Find"}
                </Button>
              </div>
            </label>

            {collection && (
              <div className="rounded-md border border-graphite-700 bg-graphite-800 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-graphite-100">{collection.name}</p>
                    <p className="mt-1 font-mono text-[11px] text-graphite-500">{compactAddress(collection.contractAddress)}</p>
                  </div>
                  <Badge tone="blue">{collection.chain === "BASE" ? "Base" : "Ethereum"}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {collection.phases.length > 0 ? (
                    collection.phases.map((phase) => (
                      <Badge key={`${phase.phaseType}-${phase.startTime}`} tone="slate">
                        {PHASE_LABELS[phase.phaseType]}
                      </Badge>
                    ))
                  ) : (
                    <Badge tone="yellow">No phases</Badge>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              <div className="metric-card"><p className="label-caps">Phases</p><p className="metric-value">{phaseCount}</p></div>
              <div className="metric-card"><p className="label-caps">Wallets</p><p className="metric-value">{selectedWalletIds.length}</p></div>
              <div className="metric-card"><p className="label-caps">Eligible</p><p className="metric-value">{eligibleWalletCount}</p></div>
            </div>

            {message && <p className="notice text-[12px]">{message}</p>}

            <Button type="button" className="w-full" onClick={handleRunCheck} disabled={checking || !collectionInput.trim() || selectedWalletIds.length === 0}>
              <Search size={14} /> {checking ? "Checking" : "Run Check"}
            </Button>
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel>
            <div className="panel-header">
              <p className="text-[14px] font-semibold text-graphite-100">Vault Wallets</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedWalletIds(wallets.map((wallet) => wallet.id));
                  resetCheckState();
                }}
              >
                Select all
              </Button>
            </div>
            {isLoading ? (
              <div className="empty-state">Loading wallets...</div>
            ) : wallets.length === 0 ? (
              <div className="empty-state">No wallets found.</div>
            ) : (
              <div className="grid gap-2 p-5 md:grid-cols-2 xl:grid-cols-3">
                {wallets.map((wallet) => {
                  const selected = selectedWalletIds.includes(wallet.id);
                  return (
                    <button
                      key={wallet.id}
                      type="button"
                      className={`rounded-md border px-3 py-3 text-left transition-colors ${selected ? "border-brand bg-brand-bg" : "border-graphite-700 bg-graphite-800 hover:border-graphite-600"}`}
                      onClick={() => toggleWallet(wallet.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-graphite-100">{wallet.name}</span>
                        <Badge tone={selected ? "green" : "slate"}>{selected ? "Selected" : wallet.network}</Badge>
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-graphite-500">{wallet.address.slice(0, 12)}...</p>
                    </button>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel>
            <div className="panel-header">
              <div>
                <p className="text-[14px] font-semibold text-graphite-100">Results</p>
                <p className="mt-0.5 text-[12px] text-graphite-500">Eligible phase names are shown per wallet.</p>
              </div>
              <Badge tone={ran ? "green" : "slate"}>{ran ? "Checked" : "Waiting"}</Badge>
            </div>
            {!ran ? (
              <div className="empty-state">Run a check to view phase eligibility.</div>
            ) : !matrix ? (
              <div className="empty-state">No results available.</div>
            ) : selectedWallets.length === 0 ? (
              <div className="empty-state">No wallets selected.</div>
            ) : (
              <div>
                <div className="border-b border-graphite-700 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-graphite-100">{matrix.collectionName}</p>
                    <Badge tone={matrix.phaseSource === "live" ? "green" : "yellow"}>{matrix.phaseSource === "live" ? "Live phases" : "Stored phases"}</Badge>
                  </div>
                  {matrix.phaseWarning && <p className="mt-2 text-[12px] text-status-yellow-text">{matrix.phaseWarning}</p>}
                </div>

                <div className="divide-y divide-graphite-700">
                  {matrix.wallets.map((result) => {
                    const eligiblePhases = result.phases.filter((phase) => phase.eligible);
                    return (
                      <div key={result.walletId} className="px-5 py-4">
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div>
                            <p className="font-medium text-graphite-100">{result.walletName}</p>
                            <p className="mt-1 font-mono text-[11px] text-graphite-500">{result.walletAddress}</p>
                          </div>
                          <div className="flex flex-wrap gap-1.5 md:justify-end">
                            {eligiblePhases.length > 0 ? (
                              eligiblePhases.map((phase) => (
                                <Badge key={phase.phaseType} tone="green">
                                  Eligible: {PHASE_LABELS[phase.phaseType]}
                                </Badge>
                              ))
                            ) : (
                              <Badge tone="red">Not eligible</Badge>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 grid gap-2 lg:grid-cols-2">
                          {result.phases.map((phase) => (
                            <div key={`${result.walletId}-${phase.phaseType}`} className="rounded-md border border-graphite-700 bg-graphite-800 px-3 py-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap gap-1.5">
                                  <Badge tone={outcomeTone(phase)}>{PHASE_LABELS[phase.phaseType]}</Badge>
                                  <Badge tone={statusTone(phase.phaseStatus)}>{phase.phaseStatus}</Badge>
                                </div>
                                <span className="text-[11px] text-graphite-500">{formatDate(phase.startTime)}</span>
                              </div>
                              <p className="mt-2 text-[12px] text-graphite-400">{phase.reason}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
