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
              <p className="text-[14px] font-semibold text-graphite-100">Collection Traits</p>
              <p className="mt-0.5 text-[12px] text-graphite-500">A cleaner view for reviewing rarity signals before sniping or minting.</p>
            </div>
            <div className="flex items-center gap-2">
              <Search size={15} className="text-graphite-500" />
              <Input className="w-[220px]" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search collections" />
            </div>
          </div>

          {isLoading ? (
            <div className="empty-state">Loading traits...</div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div>
                <ImageOff size={28} className="mx-auto text-graphite-500" />
                <p className="mt-3 font-medium text-graphite-200">No collections found</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 p-5 lg:grid-cols-2">
              {filtered.map((drop) => {
                const traits = drop.traits ?? [];
                const topTraits = traits.slice(0, 4);
                return (
                  <div key={drop.slug} className="rounded-md border border-graphite-700 bg-graphite-900 p-4">
                    <div className="flex gap-4">
                      <div className="size-16 shrink-0 overflow-hidden rounded-md border border-graphite-700 bg-graphite-800">
                        {drop.imageUrl ? <img src={drop.imageUrl} alt={drop.name} className="h-full w-full object-cover" /> : <Layers className="m-5 text-graphite-500" size={24} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="truncate text-[14px] font-semibold text-graphite-100">{drop.name}</p>
                            <p className="mt-0.5 truncate font-mono text-[11px] text-graphite-500">{drop.slug}</p>
                          </div>
                          <Badge tone={drop.chain === "BASE" ? "blue" : "slate"}>{drop.chain === "BASE" ? "Base" : "Ethereum"}</Badge>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                          <div><p className="label-caps">Floor</p><p className="mt-1 text-graphite-200">{drop.floorPriceEth != null ? `${drop.floorPriceEth} ETH` : "-"}</p></div>
                          <div><p className="label-caps">Traits</p><p className="mt-1 text-graphite-200">{traits.length}</p></div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {topTraits.length === 0 ? (
                        <p className="text-[12px] text-graphite-500 sm:col-span-2">Trait metadata is not available yet.</p>
                      ) : (
                        topTraits.map((trait) => (
                          <div key={`${trait.traitType}-${trait.value}`} className="rounded border border-graphite-700 bg-graphite-800 px-3 py-2">
                            <p className="text-[11px] text-graphite-500">{trait.traitType}</p>
                            <div className="mt-1 flex items-center justify-between gap-2">
                              <p className="truncate text-[12px] font-medium text-graphite-200">{trait.value}</p>
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
