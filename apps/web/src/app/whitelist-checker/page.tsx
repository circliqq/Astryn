"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, ChevronDown, ChevronRight, Download, Search, XCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { apiFetch } from "@/lib/api";
import { Badge, Button, Checkbox, Input, Panel } from "@/components/ui";

interface Wallet {
  id: string;
  name: string;
  address: string;
  network: "ETHEREUM" | "BASE" | "ROBINHOOD";
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
  inputLine?: string;
  failed?: boolean;
  failedError?: string;
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
    ["Collection", "Wallet", "Address", "Eligible", "Stages", "Error"],
    ...result.wallets.map((wallet) => [
      result.collectionSlug,
      wallet.walletName,
      wallet.walletAddress,
      wallet.eligible ? "yes" : "no",
      wallet.stages.map((stage) => `${stage.stage}(${stage.maxMint})`).join(", "),
      wallet.error ?? "",
    ]),
  ];
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function buildAllCsv(results: BulkResult[]) {
  const rows = [["Collection", "Wallet", "Address", "Eligible", "Stages", "Error"]];
  for (const result of results) {
    for (const wallet of result.wallets) {
      rows.push([
        result.collectionSlug,
        wallet.walletName,
        wallet.walletAddress,
        wallet.eligible ? "yes" : "no",
        wallet.stages.map((stage) => `${stage.stage}(${stage.maxMint})`).join(", "),
        wallet.error ?? "",
      ]);
    }
  }
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function CollectionResultCard({ result, defaultOpen }: { result: BulkResult; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  function downloadCsv() {
    const blob = new Blob([buildCsv(result)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `whitelist-${result.collectionSlug}-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (result.failed) {
    return (
      <div className="rounded-md border border-status-red-border bg-status-red-bg px-4 py-3">
        <div className="flex items-center gap-2">
          <XCircle size={14} className="text-status-red-text shrink-0" />
          <span className="text-[13px] font-semibold text-graphite-100 truncate">{result.inputLine ?? result.collectionSlug}</span>
          <Badge tone="red" className="ml-auto shrink-0">Failed</Badge>
        </div>
        {result.failedError && (
          <p className="mt-1 text-[11px] text-status-red-text ml-5">{result.failedError}</p>
        )}
      </div>
    );
  }

  const eligibleWallets = result.wallets.filter((w) => w.eligible);

  return (
    <div className="rounded-md border border-graphite-700 bg-graphite-900 overflow-hidden">
      {/* Header row */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-graphite-800/50 transition-colors"
      >
        {open ? <ChevronDown size={14} className="text-graphite-500 shrink-0" /> : <ChevronRight size={14} className="text-graphite-500 shrink-0" />}
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-semibold text-graphite-100 truncate">{result.collectionSlug}</span>
        </span>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] text-graphite-500">{result.walletCount} wallets</span>
          {result.eligibleWalletCount > 0 ? (
            <Badge tone="green"><CheckCircle2 size={11} /> {result.eligibleWalletCount} eligible</Badge>
          ) : (
            <Badge tone="slate">0 eligible</Badge>
          )}
          {result.errorCount > 0 && <Badge tone="red">{result.errorCount} errors</Badge>}
        </div>
      </button>

      {/* Expanded content */}
      {open && (
        <div className="border-t border-graphite-700 px-4 py-4 space-y-4">
          {/* Stage summary chips */}
          {result.stages.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {result.stages.map((stage) => (
                <div key={stage.stage} className="rounded-md border border-graphite-700 bg-graphite-800 px-3 py-1.5">
                  <span className="text-[12px] font-semibold text-graphite-100">{stage.stage}</span>
                  <span className="ml-2 text-[11px] text-graphite-500">{stage.count} wallets · max {stage.maxMint}</span>
                </div>
              ))}
            </div>
          )}

          {/* Eligible wallets highlight */}
          {eligibleWallets.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-graphite-500 uppercase tracking-wide">Eligible Wallets</p>
              {eligibleWallets.map((wallet) => (
                <div key={wallet.walletId} className="flex items-start gap-3 rounded-md border border-status-green-border bg-status-green-bg px-3 py-2">
                  <CheckCircle2 size={13} className="text-status-green-text mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="block text-[12px] font-semibold text-graphite-100">{wallet.walletName}</span>
                    <span className="font-mono text-[11px] text-graphite-500">{compactAddress(wallet.walletAddress)}</span>
                  </div>
                  <div className="text-right shrink-0">
                    {wallet.stages.map((stage) => (
                      <span key={stage.stage} className="block text-[11px] text-status-green-text">{stage.stage} ×{stage.maxMint}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Full wallet table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-[12px]">
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
                    <td className="py-2 font-semibold text-graphite-100">{wallet.walletName}</td>
                    <td className="py-2 font-mono text-graphite-500">{compactAddress(wallet.walletAddress)}</td>
                    <td className="py-2">
                      {wallet.error ? (
                        <Badge tone="red"><XCircle size={11} /> Error</Badge>
                      ) : wallet.eligible ? (
                        <Badge tone="green"><CheckCircle2 size={11} /> Eligible</Badge>
                      ) : (
                        <Badge tone="slate">Not eligible</Badge>
                      )}
                    </td>
                    <td className="py-2 text-graphite-300">
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
          </div>

          <div className="flex justify-end">
            <Button type="button" size="sm" variant="secondary" onClick={downloadCsv}>
              <Download size={13} /> CSV
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WhitelistCheckerPage() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collections, setCollections] = useState("");
  const [search, setSearch] = useState("");
  const [loadingWallets, setLoadingWallets] = useState(true);
  const [checking, setChecking] = useState(false);
  const [checkingIndex, setCheckingIndex] = useState(0);
  const [checkingTotal, setCheckingTotal] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [results, setResults] = useState<BulkResult[]>([]);

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

  const collectionLines = useMemo(() =>
    collections.split("\n").map((l) => l.trim()).filter(Boolean),
    [collections]
  );

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

  const totalEligible = results.reduce((sum, r) => sum + r.eligibleWalletCount, 0);
  const totalErrors = results.reduce((sum, r) => sum + (r.errorCount ?? 0), 0);

  async function runCheck() {
    if (collectionLines.length === 0) {
      setMessage("Enter at least one collection slug or OpenSea drop URL.");
      return;
    }
    if (selectedIds.size === 0) {
      setMessage("Select at least one Ethereum wallet.");
      return;
    }

    setChecking(true);
    setMessage(null);
    setResults([]);
    setCheckingTotal(collectionLines.length);
    setCheckingIndex(0);

    const accumulated: BulkResult[] = [];

    for (let i = 0; i < collectionLines.length; i++) {
      const line = collectionLines[i];
      setCheckingIndex(i + 1);
      try {
        const data = await apiFetch<BulkResult>("/whitelist-checker/bulk", {
          method: "POST",
          body: JSON.stringify({
            collection: line,
            walletIds: [...selectedIds],
            network: "ethereum",
          }),
        });
        accumulated.push({ ...data, inputLine: line });
      } catch (error) {
        accumulated.push({
          collectionSlug: line,
          inputLine: line,
          checkedAt: new Date().toISOString(),
          walletCount: 0,
          eligibleWalletCount: 0,
          errorCount: 1,
          stages: [],
          wallets: [],
          failed: true,
          failedError: error instanceof Error ? error.message : "Check failed.",
        });
      }
      setResults([...accumulated]);
    }

    setChecking(false);
  }

  function downloadAllCsv() {
    if (results.length === 0) return;
    const blob = new Blob([buildAllCsv(results.filter((r) => !r.failed))], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `whitelist-bulk-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const checkButtonLabel = checking
    ? `Checking ${checkingIndex} / ${checkingTotal}…`
    : collectionLines.length > 1
      ? `Check ${collectionLines.length} collections`
      : "Run bulk check";

  return (
    <AppShell title="Whitelist Checker">
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <div className="space-y-5">
          <Panel>
            <div className="panel-header">
              <div>
                <p className="text-[14px] font-semibold text-graphite-100">Collections</p>
                <p className="mt-0.5 text-[12px] text-graphite-500">One OpenSea drop URL or slug per line</p>
              </div>
              <ClipboardCheck size={17} className="text-graphite-500" />
            </div>
            <div className="space-y-4 p-5">
              <textarea
                value={collections}
                onChange={(event) => setCollections(event.target.value)}
                placeholder={"opensea.io/collection/r3ord/drop\nopensea.io/collection/another-drop\nbare-slug-also-works"}
                rows={5}
                className="w-full resize-none rounded-md border border-graphite-700 bg-graphite-800 px-3 py-2 text-[13px] text-graphite-100 placeholder:text-graphite-600 focus:border-graphite-500 focus:outline-none font-mono"
              />
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-md border border-graphite-700 bg-graphite-800 p-3">
                  <p className="label-caps">Collections</p>
                  <p className="mt-1 text-[20px] font-semibold text-graphite-100">{collectionLines.length || 0}</p>
                </div>
                <div className="rounded-md border border-graphite-700 bg-graphite-800 p-3">
                  <p className="label-caps">Eligible</p>
                  <p className="mt-1 text-[20px] font-semibold text-status-green-text">{totalEligible}</p>
                </div>
                <div className="rounded-md border border-graphite-700 bg-graphite-800 p-3">
                  <p className="label-caps">Errors</p>
                  <p className="mt-1 text-[20px] font-semibold text-status-red-text">{totalErrors}</p>
                </div>
              </div>
              {message && (
                <div className="rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-[12px] text-status-red-text">
                  {message}
                </div>
              )}
              <Button type="button" className="w-full" onClick={runCheck} disabled={checking || loadingWallets}>
                <Search size={14} /> {checkButtonLabel}
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

        {/* Results panel */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[14px] font-semibold text-graphite-100">Results</p>
              <p className="text-[12px] text-graphite-500">
                {results.length > 0
                  ? `${results.length} collection${results.length !== 1 ? "s" : ""} checked · ${totalEligible} eligible wallet${totalEligible !== 1 ? "s" : ""}`
                  : checking ? `Checking ${checkingIndex} of ${checkingTotal}…` : "Paste collections and run a check"}
              </p>
            </div>
            {results.length > 0 && (
              <Button type="button" size="sm" variant="secondary" onClick={downloadAllCsv}>
                <Download size={13} /> Export all CSV
              </Button>
            )}
          </div>

          {results.length === 0 && !checking && (
            <Panel>
              <div className="empty-state p-10">Run a check to see results.</div>
            </Panel>
          )}

          {results.map((result, index) => (
            <CollectionResultCard
              key={`${result.collectionSlug}-${index}`}
              result={result}
              defaultOpen={result.eligibleWalletCount > 0}
            />
          ))}

          {checking && checkingIndex <= checkingTotal && (
            <div className="rounded-md border border-graphite-700 bg-graphite-800 px-4 py-3 text-[12px] text-graphite-500 animate-pulse">
              Checking collection {checkingIndex} of {checkingTotal}…
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
