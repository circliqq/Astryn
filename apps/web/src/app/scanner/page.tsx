"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, Hash, Link2, Radar } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel, Select } from "@/components/ui";
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

type ScanMode = "url" | "contract";

export default function ScannerPage() {
  const router = useRouter();

  const [scanMode, setScanMode] = useState<ScanMode>("url");

  // URL mode
  const [url, setUrl] = useState("");

  // Contract address mode
  const [contractAddress, setContractAddress] = useState("");
  const [chain, setChain] = useState<"ethereum" | "base">("ethereum");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collection, setCollection] = useState<Collection | null>(null);

  async function handleScan() {
    setLoading(true);
    setError(null);
    setCollection(null);

    try {
      let data: Collection;

      if (scanMode === "url") {
        if (!url.trim()) { setLoading(false); return; }
        data = await apiFetch<Collection>("/collections/scan", {
          method: "POST",
          body: JSON.stringify({ url: url.trim() }),
        });
      } else {
        const addr = contractAddress.trim();
        if (!addr) { setLoading(false); return; }
        if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
          setError("Enter a valid contract address (0x followed by 40 hex characters).");
          setLoading(false);
          return;
        }
        data = await apiFetch<Collection>("/collections/scan-by-contract", {
          method: "POST",
          body: JSON.stringify({ contractAddress: addr, chain }),
        });
      }

      setCollection(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed.");
    } finally {
      setLoading(false);
    }
  }

  const phase = collection?.phases?.[0] ?? null;
  const chainLabel = collection?.chain === "ETHEREUM" ? "Ethereum" : "Base";
  const canScan = scanMode === "url" ? url.trim().length > 0 : contractAddress.trim().length > 0;

  return (
    <AppShell title="Collection Scanner">
      <div className="space-y-5">
        <Panel>
          <div className="panel-header">
            <div>
              <p className="text-[14px] font-semibold" style={{ color: "var(--text-1)" }}>Collection Scanner</p>
              <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-3)" }}>
                Inspect collection metadata before creating a mint task.
              </p>
            </div>
            <Radar size={18} style={{ color: "var(--text-3)" }} />
          </div>

          {/* Mode toggle */}
          <div className="segmented-control mx-5 mt-4">
            <button
              type="button"
              data-active={String(scanMode === "url")}
              onClick={() => { setScanMode("url"); setError(null); setCollection(null); }}
              className="flex items-center gap-1.5"
            >
              <Link2 size={11} />
              OpenSea URL
            </button>
            <button
              type="button"
              data-active={String(scanMode === "contract")}
              onClick={() => { setScanMode("contract"); setError(null); setCollection(null); }}
              className="flex items-center gap-1.5"
            >
              <Hash size={11} />
              Contract Address
            </button>
          </div>

          <div className="p-5">
            {scanMode === "url" ? (
              <>
                <label className="label-caps">
                  Drop or collection URL
                </label>
                <div className="mt-3 flex flex-col gap-3 md:flex-row">
                  <Input
                    className="flex-1"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://opensea.io/drops/..."
                    onKeyDown={(e) => e.key === "Enter" && handleScan()}
                  />
                  <Button type="button" onClick={handleScan} disabled={loading || !canScan}>
                    {loading ? "Scanning..." : "Scan Drop"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <label className="label-caps">
                  Contract address
                </label>
                <div className="mt-3 flex flex-col gap-3 md:flex-row">
                  <Input
                    className="flex-1 font-mono"
                    value={contractAddress}
                    onChange={(e) => setContractAddress(e.target.value)}
                    placeholder="0x..."
                    onKeyDown={(e) => e.key === "Enter" && handleScan()}
                  />
                  <Select
                    value={chain}
                    onChange={(e) => setChain(e.target.value as "ethereum" | "base")}
                  >
                    <option value="ethereum">Ethereum</option>
                    <option value="base">Base</option>
                  </Select>
                  <Button type="button" onClick={handleScan} disabled={loading || !canScan}>
                    {loading ? "Scanning..." : "Scan Drop"}
                  </Button>
                </div>
                <p className="mt-2 text-[11px]" style={{ color: "var(--text-3)" }}>
                  Looks up the collection on OpenSea by contract address — no URL needed.
                </p>
              </>
            )}

            {error && (
              <p className="mt-3 rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-[12px] text-status-red-text">
                {error}
              </p>
            )}
          </div>
        </Panel>

        {collection && (
          <>
            <Panel>
              <div className="grid gap-6 p-5 lg:grid-cols-[1fr_220px]">
                <div>
                  <div className="flex items-center gap-3">
                    <div
                      className="grid size-10 place-items-center rounded-md font-mono text-[13px] font-semibold"
                      style={{ border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-2)" }}
                    >
                      {collection.chain === "BASE" ? "B" : "E"}
                    </div>
                    <div>
                      <h2 className="text-[18px] font-semibold" style={{ color: "var(--text-1)" }}>{collection.name}</h2>
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
                        <p className="mt-1 text-[13px] font-medium" style={{ color: "var(--text-1)" }}>{value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 flex items-center gap-1.5 text-[12px] text-status-green-text">
                    <CheckCircle2 size={14} />
                    Scanned successfully
                  </div>
                </div>

                <div
                  className="aspect-square overflow-hidden rounded-md"
                  style={{ border: "1px solid var(--border)", background: "var(--surface-2)" }}
                >
                  {collection.imageUrl ? (
                    <img src={collection.imageUrl} alt={collection.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-3xl font-black" style={{ color: "var(--text-3)" }}>
                      {collection.name.slice(0, 3).toUpperCase()}
                    </div>
                  )}
                </div>
              </div>
            </Panel>

            <div className="flex justify-center">
              <Button
                type="button"
                onClick={() => router.push(`/mint-setup?collectionId=${collection.id}`)}
              >
                Continue to Mint Setup <ExternalLink size={15} />
              </Button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
