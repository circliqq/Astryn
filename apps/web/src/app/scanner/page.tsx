"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, Radar } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";

interface CollectionPhase {
  phaseType: string;
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
  supply: number | null;
  imageUrl: string | null;
  phases: CollectionPhase[];
}

function formatEth(wei: string) {
  try {
    return `${(Number(BigInt(wei)) / 1e18).toFixed(4)} ETH`;
  } catch {
    return "0.0000 ETH";
  }
}

export default function ScannerPage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collection, setCollection] = useState<Collection | null>(null);

  async function handleScan() {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setCollection(null);
    try {
      const data = await apiFetch<Collection>("/collections/scan", {
        method: "POST",
        body: JSON.stringify({ url: url.trim() }),
      });
      setCollection(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed.");
    } finally {
      setLoading(false);
    }
  }

  const phase = collection?.phases?.[0] ?? null;
  const chainLabel = collection?.chain === "ETHEREUM" ? "Ethereum" : "Base";

  return (
    <AppShell title="Collection Scanner">
      <div className="space-y-5">
        <Panel>
          <div className="panel-header">
            <div>
              <p className="text-[14px] font-semibold text-graphite-100">OpenSea Drop Scanner</p>
              <p className="mt-0.5 text-[12px] text-graphite-500">Inspect collection metadata before creating a mint task.</p>
            </div>
            <Radar size={18} className="text-graphite-500" />
          </div>
          <div className="p-5">
            <label className="text-[11px] font-medium uppercase tracking-[0.08em] text-graphite-500">Drop or collection URL</label>
            <div className="mt-3 flex flex-col gap-3 md:flex-row">
              <Input
                className="flex-1"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://opensea.io/drops/..."
                onKeyDown={(event) => event.key === "Enter" && handleScan()}
              />
              <Button type="button" onClick={handleScan} disabled={loading || !url.trim()}>
                {loading ? "Scanning..." : "Scan Drop"}
              </Button>
            </div>
            {error && <p className="mt-3 rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-[12px] text-status-red-text">{error}</p>}
          </div>
        </Panel>

        {collection && (
          <>
            <Panel>
              <div className="grid gap-6 p-5 lg:grid-cols-[1fr_220px]">
                <div>
                  <div className="flex items-center gap-3">
                    <div className="grid size-10 place-items-center rounded-md border border-graphite-700 bg-graphite-800 font-mono text-[13px] font-semibold text-graphite-300">
                      {collection.chain === "BASE" ? "B" : "E"}
                    </div>
                    <div>
                      <h2 className="text-[18px] font-semibold text-graphite-100">{collection.name}</h2>
                      <div className="mt-1"><Badge tone="blue">{chainLabel}</Badge></div>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-4 md:grid-cols-4">
                    {[
                      ["Contract", `${collection.contractAddress.slice(0, 8)}...${collection.contractAddress.slice(-4)}`],
                      ["Chain", chainLabel],
                      ["Mint Price", phase ? formatEth(phase.priceWei) : "-"],
                      ["Start Time", phase ? new Date(phase.startTime).toLocaleString() : "-"],
                      ["Phase Type", phase?.phaseType ?? "-"],
                      ["Supply", collection.supply != null ? collection.supply.toLocaleString() : "-"],
                      ["Max Mint", phase?.maxMint != null ? String(phase.maxMint) : "-"],
                      ["Slug", collection.slug],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <p className="label-caps">{label}</p>
                        <p className="mt-1 text-[13px] font-medium text-graphite-100">{value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 flex items-center gap-1.5 text-[12px] text-status-green-text">
                    <CheckCircle2 size={14} />
                    Scanned successfully
                  </div>
                </div>

                <div className="aspect-square overflow-hidden rounded-md border border-graphite-700 bg-graphite-800">
                  {collection.imageUrl ? (
                    <img src={collection.imageUrl} alt={collection.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-3xl font-black text-graphite-500">
                      {collection.name.slice(0, 3).toUpperCase()}
                    </div>
                  )}
                </div>
              </div>
            </Panel>

            <div className="flex justify-center">
              <Button type="button" onClick={() => router.push(`/mint-setup?collectionId=${collection.id}`)}>
                Continue to Mint Setup <ExternalLink size={15} />
              </Button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
