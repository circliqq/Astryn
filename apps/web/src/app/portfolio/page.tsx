"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Wallet } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";

interface PortfolioSummary {
  totalItems: number;
  totalCollections: number;
  estimatedValueEth: number | null;
  unrealizedPnlEth: number | null;
}

interface PortfolioItem {
  id: string;
  tokenId: string;
  collectionName: string;
  collectionSlug: string;
  imageUrl: string | null;
  walletName: string;
  network: "BASE" | "ETHEREUM";
  estimatedValueEth: number | null;
  acquiredAt: string | null;
}

function formatEth(value: number | null | undefined) {
  return value == null ? "-" : `${value.toFixed(4)} ETH`;
}

export default function PortfolioPage() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const { data: summary } = useQuery<PortfolioSummary>({
    queryKey: ["portfolio-summary"],
    queryFn: () => apiFetch<PortfolioSummary>("/portfolio/summary"),
  });

  const { data: items = [], isLoading } = useQuery<PortfolioItem[]>({
    queryKey: ["portfolio"],
    queryFn: () => apiFetch<PortfolioItem[]>("/portfolio"),
  });

  const sync = useMutation({
    mutationFn: () => apiFetch("/portfolio/sync", { method: "POST" }),
    onSuccess: () => {
      setMessage("Portfolio sync started.");
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-summary"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to sync portfolio."),
  });

  return (
    <AppShell title="Portfolio & PnL">
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="metric-card"><p className="label-caps">Items</p><p className="metric-value">{summary?.totalItems ?? items.length}</p></div>
          <div className="metric-card"><p className="label-caps">Collections</p><p className="metric-value">{summary?.totalCollections ?? "-"}</p></div>
          <div className="metric-card"><p className="label-caps">Value</p><p className="metric-value text-[20px]">{formatEth(summary?.estimatedValueEth)}</p></div>
          <div className="metric-card"><p className="label-caps">PnL</p><p className="metric-value text-[20px]">{formatEth(summary?.unrealizedPnlEth)}</p></div>
        </div>

        <Panel>
          <div className="panel-header">
            <div>
              <p className="text-[14px] font-semibold" style={{ color: "var(--text-1)" }}>Holdings</p>
              <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-3)" }}>Portfolio view built for scanning, not decoration.</p>
            </div>
            <Button type="button" onClick={() => sync.mutate()} disabled={sync.isPending}>
              <RefreshCw size={14} className={sync.isPending ? "animate-spin" : ""} /> Sync Portfolio
            </Button>
          </div>
          {message && (
            <p className="border-b px-5 py-2 text-[12px]" style={{ borderColor: "var(--border)", color: "var(--text-2)" }}>
              {message}
            </p>
          )}
          {isLoading ? (
            <div className="empty-state">Loading portfolio...</div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              <div>
                <Wallet size={28} className="mx-auto" style={{ color: "var(--text-3)" }} />
                <p className="mt-3 font-medium" style={{ color: "var(--text-2)" }}>No portfolio items</p>
                <p className="mt-1 text-[12px]" style={{ color: "var(--text-3)" }}>Sync to load NFT holdings from chain.</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <div key={item.id} className="panel-section p-4">
                  <div className="flex gap-4">
                    <div className="size-16 shrink-0 overflow-hidden rounded-md border" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                      {item.imageUrl ? <img src={item.imageUrl} alt={item.collectionName} className="h-full w-full object-cover" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="truncate text-[13px] font-semibold" style={{ color: "var(--text-1)" }}>{item.collectionName}</p>
                          <p className="mt-0.5 font-mono text-[11px]" style={{ color: "var(--text-3)" }}>#{item.tokenId}</p>
                        </div>
                        <Badge tone={item.network === "BASE" ? "blue" : "slate"}>{item.network === "BASE" ? "Base" : "Ethereum"}</Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                        <div><p className="label-caps">Wallet</p><p className="mt-1" style={{ color: "var(--text-2)" }}>{item.walletName}</p></div>
                        <div><p className="label-caps">Value</p><p className="mt-1" style={{ color: "var(--text-2)" }}>{formatEth(item.estimatedValueEth)}</p></div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
