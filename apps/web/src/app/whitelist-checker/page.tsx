"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, Download, Search, XCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { apiFetch } from "@/lib/api";
import { Badge, Button, Checkbox, Input, Panel } from "@/components/ui";

interface Wallet {
  id: string;
  name: string;
  address: string;
  network: "ETHEREUM" | "BASE";
  status: string;
}

interface StageResult {
  stage: string;
  stageType: string;
  stageIndex: number | null;
  maxMint: number;
}

interface WalletResult {
  walletId: string;
  walletName: string;
  walletAddress: string;
  eligible: boolean;
  stages: StageResult[];
  error: string | null;
}

interface BulkResult {
  collectionSlug: string;
  checkedAt: string;
  walletCount: number;
  eligibleWalletCount: number;
  errorCount: number;
  stages: Array<{ stage: string; maxMint: number; count: number }>;
  wallets: WalletResult[];
}

function compactAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function csvEscape(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(result: BulkResult) {
  const rows = [
    ["Wallet", "Address", "Eligible", "Stages", "Error"],
    ...result.wallets.map((wallet) => [
      wallet.walletName,
      wallet.walletAddress,
      wallet.eligible ? "yes" : "no",
      wallet.stages.map((stage) => `${stage.stage}(${stage.maxMint})`).join(", "),
      wallet.error ?? "",
    ]),
  ];
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

export default function WhitelistCheckerPage() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collection, setCollection] = useState("");
  const [search, setSearch] = useState("");
  const [loadingWallets, setLoadingWallets] = useState(true);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);

  useEffect(() => {
    apiFetch<Wallet[]>("/wallets")
      .then((data) => setWallets(data.filter((wallet) => wallet.network === "ETHEREUM")))
      .catch((error) => setMessage(error instanceof Error ? error.message : "Could not load wallets."))
      .finally(() => setLoadingWallets(false));
  }, []);

  const filteredWallets = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return wallets;
    return wallets.filter((wallet) =>
      wallet.name.toLowerCase().includes(term) || wallet.address.toLowerCase().includes(term)
    );
  }, [search, wallets]);

  function toggleWallet(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const wallet of filteredWallets) next.add(wallet.id);
      return next;
    });
  }

  async function runCheck() {
    if (!collection.trim()) {
      setMessage("Enter a collection slug or OpenSea drop URL.");
      return;
    }
    if (selectedIds.size === 0) {
      setMessage("Select at least one Ethereum wallet.");
      return;
    }

    setChecking(true);
    setMessage(null);
    setResult(null);
    try {
      const data = await apiFetch<BulkResult>("/whitelist-checker/bulk", {
        method: "POST",
        body: JSON.stringify({
          collection,
          walletIds: [...selectedIds],
          network: "ethereum",
        }),
      });
      setResult(data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Whitelist check failed.");
    } finally {
      setChecking(false);
    }
  }

  function downloadCsv() {
    if (!result) return;
    const blob = new Blob([buildCsv(result)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `whitelist-${result.collectionSlug}-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell title="Whitelist Checker">
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <div className="space-y-5">
          <Panel>
            <div className="panel-header">
              <div>
                <p className="text-[14px] font-semibold text-graphite-100">Collection</p>
                <p className="mt-0.5 text-[12px] text-graphite-500">OpenSea drop URL or slug</p>
              </div>
              <ClipboardCheck size={17} className="text-graphite-500" />
            </div>
            <div className="space-y-4 p-5">
              <Input
                value={collection}
                onChange={(event) => setCollection(event.target.value)}
                placeholder="void-saints or https://opensea.io/drops/..."
              />
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md border border-graphite-700 bg-graphite-800 p-3">
                  <p className="label-caps">Selected</p>
                  <p className="mt-1 text-[20px] font-semibold text-graphite-100">{selectedIds.size}</p>
                </div>
                <div className="rounded-md border border-graphite-700 bg-graphite-800 p-3">
                  <p className="label-caps">Eligible</p>
                  <p className="mt-1 text-[20px] font-semibold text-status-green-text">
                    {result?.eligibleWalletCount ?? 0}
                  </p>
                </div>
                <div className="rounded-md border border-graphite-700 bg-graphite-800 p-3">
                  <p className="label-caps">Errors</p>
                  <p className="mt-1 text-[20px] font-semibold text-status-red-text">{result?.errorCount ?? 0}</p>
                </div>
              </div>
              {message && (
                <div className="rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-[12px] text-status-red-text">
                  {message}
                </div>
              )}
              <Button type="button" className="w-full" onClick={runCheck} disabled={checking || loadingWallets}>
                <Search size={14} /> {checking ? "Checking" : "Run bulk check"}
              </Button>
            </div>
          </Panel>

          <Panel>
            <div className="panel-header">
              <div>
                <p className="text-[14px] font-semibold text-graphite-100">Wallets</p>
                <p className="mt-0.5 text-[12px] text-graphite-500">Ethereum vault wallets</p>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={selectAllFiltered}>
                Select all
              </Button>
            </div>
            <div className="space-y-3 p-5">
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search wallet" />
              <div className="max-h-[470px] space-y-2 overflow-auto pr-1">
                {filteredWallets.map((wallet) => (
                  <button
                    key={wallet.id}
                    type="button"
                    onClick={() => toggleWallet(wallet.id)}
                    className="flex w-full items-center gap-3 rounded-md border border-graphite-700 bg-graphite-800 px-3 py-2.5 text-left hover:border-graphite-600"
                  >
                    <Checkbox checked={selectedIds.has(wallet.id)} readOnly />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-graphite-100">{wallet.name}</span>
                      <span className="font-mono text-[11px] text-graphite-500">{compactAddress(wallet.address)}</span>
                    </span>
                    <Badge tone={wallet.status === "READY" ? "green" : "slate"}>{wallet.status}</Badge>
                  </button>
                ))}
                {!loadingWallets && filteredWallets.length === 0 && (
                  <div className="empty-state">No Ethereum wallets found.</div>
                )}
              </div>
            </div>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel>
            <div className="panel-header">
              <div>
                <p className="text-[14px] font-semibold text-graphite-100">Stage Summary</p>
                <p className="mt-0.5 text-[12px] text-graphite-500">
                  {result ? result.collectionSlug : "No check run"}
                </p>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={downloadCsv} disabled={!result}>
                <Download size={13} /> CSV
              </Button>
            </div>
            <div className="p-5">
              {result && result.stages.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {result.stages.map((stage) => (
                    <div key={stage.stage} className="rounded-md border border-graphite-700 bg-graphite-800 p-3">
                      <p className="text-[13px] font-semibold text-graphite-100">{stage.stage}</p>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-[11px] text-graphite-500">Wallets</span>
                        <span className="font-mono text-[13px] text-status-green-text">{stage.count}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-3">
                        <span className="text-[11px] text-graphite-500">Max mint</span>
                        <span className="font-mono text-[13px] text-graphite-200">{stage.maxMint}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">{result ? "No eligible stages found." : "Run a bulk check."}</div>
              )}
            </div>
          </Panel>

          <Panel>
            <div className="panel-header">
              <div>
                <p className="text-[14px] font-semibold text-graphite-100">Results</p>
                <p className="mt-0.5 text-[12px] text-graphite-500">
                  {result ? `${result.walletCount} wallets checked` : "Waiting for check"}
                </p>
              </div>
            </div>
            <div className="overflow-x-auto p-5">
              {result ? (
                <table className="w-full min-w-[720px] text-left text-[12px]">
                  <thead className="text-graphite-500">
                    <tr>
                      <th className="pb-2 font-medium">Wallet</th>
                      <th className="pb-2 font-medium">Address</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">Stages</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-graphite-800">
                    {result.wallets.map((wallet) => (
                      <tr key={wallet.walletId}>
                        <td className="py-3 font-semibold text-graphite-100">{wallet.walletName}</td>
                        <td className="py-3 font-mono text-graphite-500">{compactAddress(wallet.walletAddress)}</td>
                        <td className="py-3">
                          {wallet.error ? (
                            <Badge tone="red">
                              <XCircle size={11} /> Error
                            </Badge>
                          ) : wallet.eligible ? (
                            <Badge tone="green">
                              <CheckCircle2 size={11} /> Eligible
                            </Badge>
                          ) : (
                            <Badge tone="slate">Not eligible</Badge>
                          )}
                        </td>
                        <td className="py-3 text-graphite-300">
                          {wallet.error
                            ? wallet.error
                            : wallet.stages.length > 0
                              ? wallet.stages.map((stage) => `${stage.stage} (${stage.maxMint})`).join(", ")
                              : "No stage"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty-state">No results yet.</div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
