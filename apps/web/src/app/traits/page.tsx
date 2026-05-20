"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff, Layers, Search } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";

interface Drop {
  slug: string;
  name: string;
  imageUrl: string | null;
  chain: "BASE" | "ETHEREUM" | string;
  contractAddress?: string | null;
  floorPriceEth?: number | null;
  traits?: Array<{ traitType: string; value: string; count?: number; rarityScore?: number }>;
}

export default function TraitsPage() {
  const [query, setQuery] = useState("");
  const { data: drops = [], isLoading } = useQuery<Drop[]>({
    queryKey: ["opensea-drops"],
    queryFn: () => apiFetch<Drop[]>("/opensea/drops"),
  });

  const filtered = drops.filter((drop) => {
    const needle = query.toLowerCase();
    return !needle || drop.name.toLowerCase().includes(needle) || drop.slug.toLowerCase().includes(needle);
  });

  return (
    <AppShell title="Trait Explorer">
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="metric-card"><p className="label-caps">Collections</p><p className="metric-value">{drops.length}</p></div>
          <div className="metric-card"><p className="label-caps">Visible</p><p className="metric-value">{filtered.length}</p></div>
          <div className="metric-card"><p className="label-caps">Source</p><p className="metric-value text-[20px]">OpenSea</p></div>
        </div>

        <Panel>
          <div className="panel-header">
            <div>
              <p className="text-[14px] font-semibold" style={{ color: "var(--text-1)" }}>Collection Traits</p>
              <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-3)" }}>A cleaner view for reviewing rarity signals before sniping or minting.</p>
            </div>
            <div className="flex items-center gap-2">
              <Search size={15} style={{ color: "var(--text-3)" }} />
              <Input className="w-[220px]" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search collections" />
            </div>
          </div>

          {isLoading ? (
            <div className="empty-state">Loading traits...</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div>
                <ImageOff size={28} className="mx-auto" style={{ color: "var(--text-3)" }} />
                <p className="mt-3 font-medium" style={{ color: "var(--text-2)" }}>No collections found</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 p-5 lg:grid-cols-2">
              {filtered.map((drop) => {
                const traits = drop.traits ?? [];
                const topTraits = traits.slice(0, 4);
                return (
                  <div key={drop.slug} className="panel-section p-4">
                    <div className="flex gap-4">
                      <div className="size-16 shrink-0 overflow-hidden rounded-md border" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                        {drop.imageUrl
                          ? <img src={drop.imageUrl} alt={drop.name} className="h-full w-full object-cover" />
                          : <Layers className="m-5" size={24} style={{ color: "var(--text-3)" }} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="truncate text-[14px] font-semibold" style={{ color: "var(--text-1)" }}>{drop.name}</p>
                            <p className="mt-0.5 truncate font-mono text-[11px]" style={{ color: "var(--text-3)" }}>{drop.slug}</p>
                          </div>
                          <Badge tone={drop.chain === "BASE" ? "blue" : "slate"}>{drop.chain === "BASE" ? "Base" : "Ethereum"}</Badge>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                          <div><p className="label-caps">Floor</p><p className="mt-1" style={{ color: "var(--text-2)" }}>{drop.floorPriceEth != null ? `${drop.floorPriceEth} ETH` : "-"}</p></div>
                          <div><p className="label-caps">Traits</p><p className="mt-1" style={{ color: "var(--text-2)" }}>{traits.length}</p></div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {topTraits.length === 0 ? (
                        <p className="text-[12px] sm:col-span-2" style={{ color: "var(--text-3)" }}>Trait metadata is not available yet.</p>
                      ) : (
                        topTraits.map((trait) => (
                          <div
                            key={`${trait.traitType}-${trait.value}`}
                            className="rounded border px-3 py-2"
                            style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
                          >
                            <p className="text-[11px]" style={{ color: "var(--text-3)" }}>{trait.traitType}</p>
                            <div className="mt-1 flex items-center justify-between gap-2">
                              <p className="truncate text-[12px] font-medium" style={{ color: "var(--text-2)" }}>{trait.value}</p>
                              <Badge tone={(trait.rarityScore ?? 0) > 80 ? "green" : "slate"}>{trait.rarityScore ?? trait.count ?? "-"}</Badge>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
