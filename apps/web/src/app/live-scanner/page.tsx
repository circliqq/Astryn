"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Flame,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";

interface ScannedDrop {
  id: string;
  chain: "ETHEREUM" | "BASE";
  contractAddress: string;
  slug: string | null;
  name: string | null;
  symbol: string | null;
  imageUrl: string | null;
  publicStartTime: string | null;
  publicPriceWei: string | null;
  supply: number | null;
  maxSupply: number | null;
  holders: number | null;
  floorEth: string | null;
  topOfferEth: string | null;
  volume24hEth: string | null;
  salesCount: number | null;
  mints5m: number;
  minters5m: number;
  deployedAt: string | null;
  verified: boolean;
  hasTwitter: boolean;
  hasDiscord: boolean;
  hasWebsite: boolean;
  riskScore: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  riskFlags: string[];
  status: "upcoming" | "live" | "ended";
}

function priceEth(wei: string | null) {
  if (!wei) return "—";
  try {
    const v = Number(BigInt(wei)) / 1e18;
    return v === 0 ? "FREE" : `${v} ETH`;
  } catch {
    return "—";
  }
}
function ethShort(v: string | null | undefined) {
  if (!v) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(n < 1 ? 5 : 2)} Ξ`;
}
function ago(iso: string | null) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "soon";
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  return `${m}m ago`;
}
function countdownIn(iso: string | null) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}
function pct(cur: number | null, max: number | null) {
  if (!cur || !max || max <= 0) return null;
  return Math.min(100, Math.round((cur / max) * 100));
}
function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
function riskTone(level: string): "green" | "yellow" | "red" {
  return level === "LOW" ? "green" : level === "MEDIUM" ? "yellow" : "red";
}

type SortKey = "minting" | "supplyLeft";

export default function LiveScannerPage() {
  const router = useRouter();
  const [chain, setChain] = useState("");
  const [status, setStatus] = useState("");
  const [maxRisk, setMaxRisk] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("minting");
  const [onlyFree, setOnlyFree] = useState(false);
  const [onlyLinked, setOnlyLinked] = useState(false);
  const [onlyTwitter, setOnlyTwitter] = useState(false);
  const [mintingId, setMintingId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (chain) p.set("chain", chain);
    if (status) p.set("status", status);
    if (maxRisk) p.set("maxRisk", maxRisk);
    if (q.trim()) p.set("q", q.trim());
    return p.toString();
  }, [chain, status, maxRisk, q]);

  const { data: raw = [], isFetching, refetch, dataUpdatedAt } = useQuery<ScannedDrop[]>({
    queryKey: ["scanner-feed", qs],
    queryFn: () => apiFetch<ScannedDrop[]>(`/scanner-feed${qs ? `?${qs}` : ""}`),
    refetchInterval: 15_000,
  });

  const scanNow = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>("/scanner-feed/scan-now", { method: "POST" }),
    onSuccess: () => setTimeout(() => void refetch(), 4000),
  });

  // Open the normal mint-setup flow: resolve/create a Collection, then route to it.
  async function goMint(d: ScannedDrop) {
    setPageError(null);
    setMintingId(d.id);
    try {
      const col = await apiFetch<{ id: string }>("/collections/scan-by-contract", {
        method: "POST",
        body: JSON.stringify({
          contractAddress: d.contractAddress,
          chain: d.chain === "BASE" ? "base" : "ethereum",
        }),
      });
      router.push(`/mint-setup?collectionId=${col.id}`);
    } catch (e) {
      setMintingId(null);
      setPageError(e instanceof Error ? e.message : "Could not open mint setup for this collection.");
    }
  }

  const drops = useMemo(() => {
    let list = [...raw];
    if (onlyFree) list = list.filter((d) => !d.publicPriceWei || d.publicPriceWei === "0");
    if (onlyLinked) list = list.filter((d) => d.hasTwitter || d.hasDiscord || d.hasWebsite);
    if (onlyTwitter) list = list.filter((d) => d.hasTwitter);
    list.sort((a, b) => {
      if (sort === "minting") return b.mints5m - a.mints5m;
      const al = (a.maxSupply ?? 0) - (a.supply ?? 0);
      const bl = (b.maxSupply ?? 0) - (b.supply ?? 0);
      return bl - al;
    });
    return list;
  }, [raw, onlyFree, onlyLinked, onlyTwitter, sort]);

  const live = raw.filter((d) => d.status === "live").length;

  return (
    <AppShell title="Live Scanner">
      <div className="space-y-4">
        {/* Status bar */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-graphite-500">
          <span className="flex items-center gap-1.5 text-status-green-text">
            <span className="size-[7px] rounded-full bg-status-green-text" /> {live} minting now
          </span>
          <span>· on-chain SeaDrop · ETH + Base</span>
          {dataUpdatedAt > 0 && <span>· updated {new Date(dataUpdatedAt).toLocaleTimeString()}</span>}
          {isFetching && <Loader2 size={11} className="animate-spin" />}
        </div>

        {pageError && (
          <p className="rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-[12px] text-status-red-text">
            {pageError}
          </p>
        )}

        {/* Sort + filters */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-graphite-500">Sort</span>
          {(
            [
              ["minting", "Minting count"],
              ["supplyLeft", "Supply left"],
            ] as [SortKey, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSort(k)}
              className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
                sort === k
                  ? "border-brand bg-brand-bg text-graphite-100"
                  : "border-graphite-700 bg-graphite-800 text-graphite-400 hover:border-graphite-600"
              }`}
            >
              {label}
            </button>
          ))}
          <span className="ml-2 text-[11px] font-medium uppercase tracking-wider text-graphite-500">Filter</span>
          <button
            type="button"
            onClick={() => setOnlyFree((v) => !v)}
            className={`rounded-full border px-3 py-1 text-[12px] ${
              onlyFree ? "border-brand bg-brand-bg text-graphite-100" : "border-graphite-700 bg-graphite-800 text-graphite-400"
            }`}
          >
            Free
          </button>
          <button
            type="button"
            onClick={() => setOnlyLinked((v) => !v)}
            className={`flex items-center gap-1 rounded-full border px-3 py-1 text-[12px] ${
              onlyLinked ? "border-brand bg-brand-bg text-graphite-100" : "border-graphite-700 bg-graphite-800 text-graphite-400"
            }`}
          >
            <Link2 size={11} /> Linked
          </button>
          <button
            type="button"
            onClick={() => setOnlyTwitter((v) => !v)}
            className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${
              onlyTwitter ? "border-brand bg-brand-bg text-graphite-100" : "border-graphite-700 bg-graphite-800 text-graphite-400"
            }`}
            title="Only collections with an X / Twitter account"
          >
            𝕏 account
          </button>
          <div className="ml-auto flex items-center gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search…" className="h-8 w-40" />
            <select
              value={chain}
              onChange={(e) => setChain(e.target.value)}
              className="h-8 rounded-md border border-graphite-700 bg-graphite-800 px-2 text-[12px] text-graphite-100"
            >
              <option value="">All chains</option>
              <option value="ETHEREUM">ETH</option>
              <option value="BASE">Base</option>
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-8 rounded-md border border-graphite-700 bg-graphite-800 px-2 text-[12px] text-graphite-100"
            >
              <option value="">Live + upcoming</option>
              <option value="live">Live</option>
              <option value="upcoming">Upcoming</option>
              <option value="ended">Ended</option>
            </select>
            <Button type="button" onClick={() => scanNow.mutate()} disabled={scanNow.isPending}>
              {scanNow.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            </Button>
          </div>
        </div>

        {/* Card grid */}
        {drops.length === 0 ? (
          <Panel>
            <p className="notice m-5">
              No drops detected yet. The scanner runs on a timer — hit the refresh button or check back shortly.
            </p>
          </Panel>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {drops.map((d) => {
              const supplyPct = pct(d.supply, d.maxSupply);
              const hot = d.mints5m >= 10;
              const inMin = countdownIn(d.publicStartTime);
              return (
                <div
                  key={d.id}
                  className="rounded-lg border border-graphite-700 bg-graphite-900/40 p-4"
                  title={d.riskFlags.join(" · ")}
                >
                  {/* Header */}
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-1.5">
                        {hot && (
                          <span className="flex items-center gap-1 rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-orange-400">
                            <Flame size={10} /> HOT
                          </span>
                        )}
                        <Badge tone={d.status === "live" ? "green" : d.status === "upcoming" ? "yellow" : "slate"}>
                          {d.status === "upcoming" && inMin ? `in ${inMin}` : d.status.toUpperCase()}
                        </Badge>
                        <Badge tone={riskTone(d.riskLevel)}>
                          {d.riskLevel === "HIGH" ? (
                            <span className="flex items-center gap-1"><AlertTriangle size={9} /> {d.riskLevel}</span>
                          ) : d.riskLevel === "LOW" ? (
                            <span className="flex items-center gap-1"><CheckCircle2 size={9} /> SAFE</span>
                          ) : (
                            "MED"
                          )}
                        </Badge>
                      </div>
                      <p className="flex items-center gap-1.5 truncate font-semibold text-graphite-100">
                        {d.name ?? short(d.contractAddress)}
                        {d.symbol && <span className="text-[12px] font-normal text-graphite-500">({d.symbol})</span>}
                        {d.verified && <ShieldCheck size={13} className="shrink-0 text-status-green-text" />}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-orange-400">
                        <Flame size={11} /> {d.mints5m} in last 5m · {d.minters5m} wallet{d.minters5m === 1 ? "" : "s"}
                      </p>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={d.imageUrl ?? ""}
                      alt=""
                      className="size-12 shrink-0 rounded-md bg-graphite-800 object-cover"
                      onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
                    />
                  </div>

                  {/* Stats grid */}
                  <div className="mt-3 grid grid-cols-3 gap-y-3 text-[12px]">
                    <Stat label="Supply">
                      {d.supply != null && d.maxSupply ? (
                        <>
                          {d.supply.toLocaleString()}/{d.maxSupply.toLocaleString()}
                          {supplyPct != null && <span className="text-graphite-500"> ({supplyPct}%)</span>}
                        </>
                      ) : (
                        d.supply?.toLocaleString() ?? "—"
                      )}
                    </Stat>
                    <Stat label="Mint price">
                      <span className={priceEth(d.publicPriceWei) === "FREE" ? "font-semibold text-status-green-text" : ""}>
                        {priceEth(d.publicPriceWei)}
                      </span>
                    </Stat>
                    <Stat label="Deployed">{ago(d.deployedAt)}</Stat>
                    <Stat label="Holders">
                      {d.holders?.toLocaleString() ?? "—"}
                    </Stat>
                    <Stat label="Floor">{ethShort(d.floorEth)}</Stat>
                    <Stat label="Top offer">{ethShort(d.topOfferEth)}</Stat>
                    <Stat label="Vol 24h">{ethShort(d.volume24hEth)}</Stat>
                    <Stat label="Sales">{d.salesCount?.toLocaleString() ?? "—"}</Stat>
                    <Stat label="Links">
                      <span className="flex gap-1.5 text-brand">
                        {d.hasTwitter && <span>x</span>}
                        {d.hasWebsite && <span>web</span>}
                        {d.hasDiscord && <span>discord</span>}
                        {!d.hasWebsite && !d.hasDiscord && !d.hasTwitter && <span className="text-graphite-600">—</span>}
                      </span>
                    </Stat>
                  </div>

                  {supplyPct != null && (
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-graphite-800">
                      <div className="h-full bg-brand" style={{ width: `${supplyPct}%` }} />
                    </div>
                  )}

                  {/* Actions */}
                  <div className="mt-3 flex items-center gap-2">
                    <Button
                      className="flex-1"
                      type="button"
                      disabled={mintingId === d.id}
                      onClick={() => goMint(d)}
                    >
                      {mintingId === d.id ? (
                        <span className="flex items-center justify-center gap-1.5">
                          <Loader2 size={12} className="animate-spin" /> Opening…
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-1.5">
                          <Zap size={12} /> Mint
                        </span>
                      )}
                    </Button>
                    {d.slug && (
                      <a
                        href={`https://opensea.io/collection/${d.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-graphite-700 px-2.5 py-2 text-[12px] text-graphite-300 hover:border-graphite-600"
                      >
                        OS ↗
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="text-[11px] text-graphite-500">
          Detected from on-chain SeaDrop activity + OpenSea. Velocity, floor &amp; risk are heuristics —
          always DYOR before minting. Not financial advice.
        </p>
      </div>
    </AppShell>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-graphite-500">{label}</p>
      <p className="mt-0.5 truncate text-graphite-100">{children}</p>
    </div>
  );
}
