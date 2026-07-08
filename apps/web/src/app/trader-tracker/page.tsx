"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  UserSearch,
  Wallet,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel, Select } from "@/components/ui";
import { apiFetch } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TraderPurchaseLog {
  id: string;
  collectionSlug: string;
  collectionName: string | null;
  nftName: string | null;
  imageUrl: string | null;
  priceEth: number;
  quantity: number;
  source: string | null;
  txHash: string | null;
  eventTimestamp: string;
  detectedAt: string;
  trackedWallet?: {
    nickname: string;
    address: string;
    network: "BASE" | "ETHEREUM" | "ROBINHOOD";
  };
}

interface TrackedWallet {
  id: string;
  address: string;
  nickname: string;
  network: "BASE" | "ETHEREUM" | "ROBINHOOD";
  enabled: boolean;
  lastCheckedAt: string | null;
  createdAt: string;
  purchases: TraderPurchaseLog[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function shortAddr(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function explorerTxUrl(txHash: string, network: "BASE" | "ETHEREUM" | "ROBINHOOD"): string {
  if (network === "BASE") return `https://basescan.org/tx/${txHash}`;
  return `https://etherscan.io/tx/${txHash}`;
}

// ── Purchase Feed Item ─────────────────────────────────────────────────────────

function PurchaseFeedItem({ log, network }: { log: TraderPurchaseLog; network: "BASE" | "ETHEREUM" | "ROBINHOOD" }) {
  const nickname = log.trackedWallet?.nickname ?? "Unknown";
  const addr = log.trackedWallet?.address ?? "";
  const net = log.trackedWallet?.network ?? network;
  const collection = log.collectionName ?? log.collectionSlug;
  const priceStr = log.priceEth.toFixed(4);

  return (
    <div
      className="rounded-lg border p-4 transition-colors hover:border-brand/30"
      style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
    >
      {/* Header */}
      <div className="mb-3 flex items-center gap-2 text-[12px]" style={{ color: "var(--text-3)" }}>
        <div className="size-2 rounded-full bg-emerald-400" />
        <span className="font-semibold" style={{ color: "var(--text-2)" }}>{nickname}</span>
        <span>just purchased</span>
        <a
          href={`https://opensea.io/collection/${log.collectionSlug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-brand hover:underline"
        >
          {collection}
        </a>
        <span>for</span>
        <span className="font-bold" style={{ color: "var(--text-1)" }}>{priceStr} ETH</span>
        <span className="ml-auto">{timeAgo(log.detectedAt)}</span>
      </div>

      {/* Card body */}
      <div
        className="flex items-start gap-3 rounded-md border p-3"
        style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
      >
        {/* NFT image */}
        {log.imageUrl ? (
          <img
            src={log.imageUrl}
            alt={log.nftName ?? collection}
            className="size-16 shrink-0 rounded-md object-cover border"
            style={{ borderColor: "var(--border)" }}
          />
        ) : (
          <div
            className="size-16 shrink-0 rounded-md border flex items-center justify-center"
            style={{ borderColor: "var(--border)", background: "var(--surface-3)" }}
          >
            <Wallet size={20} style={{ color: "var(--text-3)" }} />
          </div>
        )}

        {/* Details grid */}
        <div className="flex-1 min-w-0 grid grid-cols-3 gap-x-6 gap-y-2 text-[12px]">
          <div>
            <p className="mb-0.5 font-semibold uppercase tracking-wide text-[10px]" style={{ color: "var(--text-3)" }}>Trader</p>
            <a
              href={`https://opensea.io/${addr}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 font-medium hover:text-brand"
              style={{ color: "var(--text-2)" }}
            >
              {nickname}
              <ExternalLink size={10} />
            </a>
            <p className="mt-0.5 font-mono text-[10px]" style={{ color: "var(--text-3)" }}>{shortAddr(addr)}</p>
          </div>

          <div>
            <p className="mb-0.5 font-semibold uppercase tracking-wide text-[10px]" style={{ color: "var(--text-3)" }}>Collection</p>
            <a
              href={`https://opensea.io/collection/${log.collectionSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 font-medium hover:text-brand truncate"
              style={{ color: "var(--text-2)" }}
            >
              {collection}
              <ExternalLink size={10} className="shrink-0" />
            </a>
            <p className="mt-0.5 text-[10px]" style={{ color: "var(--text-3)" }}>ERC721</p>
          </div>

          <div>
            <p className="mb-0.5 font-semibold uppercase tracking-wide text-[10px]" style={{ color: "var(--text-3)" }}>Price</p>
            <p className="font-semibold" style={{ color: "var(--text-1)" }}>{priceStr} ETH</p>
            <p className="mt-0.5 text-[10px]" style={{ color: "var(--text-3)" }}>
              {log.quantity > 1 ? `(${(log.priceEth / log.quantity).toFixed(4)} ETH each)` : ""}
            </p>
          </div>

          <div>
            <p className="mb-0.5 font-semibold uppercase tracking-wide text-[10px]" style={{ color: "var(--text-3)" }}>Amount</p>
            <p style={{ color: "var(--text-2)" }}>{log.quantity} NFT{log.quantity !== 1 ? "s" : ""}</p>
          </div>

          <div>
            <p className="mb-0.5 font-semibold uppercase tracking-wide text-[10px]" style={{ color: "var(--text-3)" }}>Source</p>
            <p style={{ color: "var(--text-2)" }}>{log.source ?? "OpenSea"}</p>
          </div>

          <div>
            <p className="mb-0.5 font-semibold uppercase tracking-wide text-[10px]" style={{ color: "var(--text-3)" }}>Time</p>
            <p style={{ color: "var(--text-2)" }}>{timeAgo(log.eventTimestamp)}</p>
          </div>
        </div>
      </div>

      {/* Footer links */}
      <div className="mt-2 flex items-center gap-3">
        <a
          href={`https://opensea.io/collection/${log.collectionSlug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[11px] hover:text-brand"
          style={{ color: "var(--text-3)" }}
        >
          OpenSea <ExternalLink size={10} />
        </a>
        <a
          href={`https://opensea.io/${addr}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[11px] hover:text-brand"
          style={{ color: "var(--text-3)" }}
        >
          Trader <ExternalLink size={10} />
        </a>
        {log.txHash && (
          <a
            href={explorerTxUrl(log.txHash, net)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] hover:text-brand"
            style={{ color: "var(--text-3)" }}
          >
            TX <ExternalLink size={10} />
          </a>
        )}
      </div>
    </div>
  );
}

// ── Wallet Card ───────────────────────────────────────────────────────────────

function WalletCard({ wallet, onRefresh }: { wallet: TrackedWallet; onRefresh: () => void }) {
  const qc = useQueryClient();
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleMutation = useMutation({
    mutationFn: () => apiFetch(`/trader-tracker/${wallet.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !wallet.enabled }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trader-tracker"] }),
    onError: (err) => setError(err instanceof Error ? err.message : "Failed."),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/trader-tracker/${wallet.id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trader-tracker"] }),
    onError: (err) => setError(err instanceof Error ? err.message : "Failed."),
  });

  async function pollNow() {
    setPolling(true); setError(null);
    try {
      await apiFetch(`/trader-tracker/${wallet.id}/poll`, { method: "POST" });
      qc.invalidateQueries({ queryKey: ["trader-tracker"] });
      qc.invalidateQueries({ queryKey: ["trader-feed"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Poll failed.");
    } finally {
      setPolling(false);
    }
  }

  return (
    <div
      className="flex items-center justify-between rounded-lg border px-4 py-3"
      style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`size-2 rounded-full shrink-0 ${wallet.enabled ? "bg-emerald-400" : "bg-graphite-500"}`}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[13px]" style={{ color: "var(--text-1)" }}>
              {wallet.nickname}
            </span>
            <Badge tone={wallet.network === "ETHEREUM" ? "blue" : "slate"}>
              {wallet.network === "ETHEREUM" ? "Ethereum" : wallet.network === "ROBINHOOD" ? "Robinhood" : "Base"}
            </Badge>
            {!wallet.enabled && <Badge tone="slate">Paused</Badge>}
          </div>
          <p className="mt-0.5 font-mono text-[11px]" style={{ color: "var(--text-3)" }}>
            {wallet.address}
          </p>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-3)" }}>
            {wallet.purchases.length} purchase{wallet.purchases.length !== 1 ? "s" : ""} logged
            {wallet.lastCheckedAt && ` · Checked ${timeAgo(wallet.lastCheckedAt)}`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Button variant="secondary" onClick={pollNow} disabled={polling}>
          {polling ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </Button>
        <Button variant="secondary" onClick={() => toggleMutation.mutate()} disabled={toggleMutation.isPending}>
          {wallet.enabled
            ? <Pause size={13} className="text-amber-400" />
            : <Play size={13} className="text-emerald-400" />}
        </Button>
        <Button variant="secondary" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
          <Trash2 size={13} className="text-status-red-text" />
        </Button>
      </div>

      {error && (
        <p className="mt-1 text-[11px] text-status-red-text">{error}</p>
      )}
    </div>
  );
}

// ── Add Wallet Form ───────────────────────────────────────────────────────────

function AddWalletForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [nickname, setNickname] = useState("");
  const [network, setNetwork] = useState<"BASE" | "ETHEREUM" | "ROBINHOOD">("ETHEREUM");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch("/trader-tracker", {
        method: "POST",
        body: JSON.stringify({ address: address.trim(), nickname: nickname.trim(), network }),
      }),
    onSuccess: () => {
      setAddress(""); setNickname(""); setError(null); setOpen(false);
      onAdded();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to add wallet."),
  });

  return (
    <Panel>
      <button
        type="button"
        className="flex w-full items-center justify-between p-5"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <div className="grid size-8 place-items-center rounded-md" style={{ background: "var(--surface-2)" }}>
            <Plus size={15} style={{ color: "var(--text-3)" }} />
          </div>
          <div className="text-left">
            <p className="text-[14px] font-semibold" style={{ color: "var(--text-1)" }}>
              Add Wallet to Track
            </p>
            <p className="text-[12px]" style={{ color: "var(--text-3)" }}>
              Enter a wallet address and give it a nickname to track purchases.
            </p>
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t px-5 pb-5 pt-4 space-y-4" style={{ borderColor: "var(--border)" }}>
          <div className="grid gap-3 md:grid-cols-[1fr_180px_160px_auto]">
            <label>
              <span className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-3)" }}>
                Wallet Address
              </span>
              <Input
                placeholder="0xd808E18Bfa04e99B8598E88d6fb0208546c2bD25"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-3)" }}>
                Nickname
              </span>
              <Input
                placeholder="TMA wallet 2"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={32}
              />
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-3)" }}>
                Network
              </span>
              <Select value={network} onChange={(e) => setNetwork(e.target.value as "BASE" | "ETHEREUM" | "ROBINHOOD")}>
                <option value="ETHEREUM">Ethereum</option>
                <option value="BASE">Base</option>
              </Select>
            </label>
            <div className="flex items-end">
              <Button
                onClick={() => {
                  if (!address.trim()) { setError("Enter a wallet address."); return; }
                  if (!nickname.trim()) { setError("Enter a nickname."); return; }
                  mutation.mutate();
                }}
                disabled={mutation.isPending}
              >
                {mutation.isPending
                  ? <><Loader2 size={14} className="animate-spin" /> Adding…</>
                  : <><Plus size={14} /> Add Wallet</>}
              </Button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-md border border-status-red-border bg-status-red-bg px-3 py-2 text-[12px] text-status-red-text">
              <AlertCircle size={13} /> {error}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TraderTrackerPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"feed" | "wallets">("feed");

  const { data: wallets = [], isLoading: walletsLoading } = useQuery<TrackedWallet[]>({
    queryKey: ["trader-tracker"],
    queryFn: () => apiFetch<TrackedWallet[]>("/trader-tracker"),
    refetchInterval: 30_000,
  });

  const { data: feed = [], isLoading: feedLoading } = useQuery<TraderPurchaseLog[]>({
    queryKey: ["trader-feed"],
    queryFn: () => apiFetch<TraderPurchaseLog[]>("/trader-tracker/feed"),
    refetchInterval: 30_000,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["trader-tracker"] });
    qc.invalidateQueries({ queryKey: ["trader-feed"] });
  }

  const activeWallets = wallets.filter((w) => w.enabled).length;

  return (
    <AppShell title="Sweep Alerts">
      <div className="space-y-5">

        {/* ── Stats ── */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="metric-card">
            <p className="label-caps">Tracked Wallets</p>
            <p className="metric-value">{wallets.length}</p>
          </div>
          <div className="metric-card">
            <p className="label-caps">Active</p>
            <p className="metric-value">{activeWallets}</p>
          </div>
          <div className="metric-card">
            <p className="label-caps">Total Purchases Logged</p>
            <p className="metric-value">{feed.length}</p>
          </div>
        </div>

        {/* ── Add wallet ── */}
        <AddWalletForm onAdded={refresh} />

        {/* ── Tabs ── */}
        <div className="flex items-center gap-1 rounded-lg p-1 w-fit" style={{ background: "var(--surface-2)" }}>
          {(["feed", "wallets"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-md px-4 py-1.5 text-[13px] font-medium transition-colors ${
                activeTab === tab
                  ? "text-white"
                  : ""
              }`}
              style={
                activeTab === tab
                  ? { background: "var(--brand)", color: "#fff" }
                  : { color: "var(--text-3)" }
              }
            >
              {tab === "feed" ? "Purchase Feed" : "Wallets"}
            </button>
          ))}
        </div>

        {/* ── Feed tab ── */}
        {activeTab === "feed" && (
          <div className="space-y-3">
            {feedLoading && (
              <Panel className="p-8 text-center text-sm" style={{ color: "var(--text-3)" }}>
                <Loader2 size={20} className="mx-auto mb-3 animate-spin" />
                Loading feed…
              </Panel>
            )}

            {!feedLoading && feed.length === 0 && (
              <Panel>
                <div className="flex flex-col items-center px-6 py-12 text-center">
                  <div className="grid size-[52px] place-items-center rounded-full" style={{ background: "var(--surface-2)" }}>
                    <UserSearch size={24} style={{ color: "var(--text-3)" }} />
                  </div>
                  <p className="mt-3 text-[13px] font-medium" style={{ color: "var(--text-2)" }}>
                    No purchases yet
                  </p>
                  <p className="mt-1 text-[12px]" style={{ color: "var(--text-3)" }}>
                    Add wallets above and hit the refresh button to pull recent purchases.
                  </p>
                </div>
              </Panel>
            )}

            {feed.map((log) => (
              <PurchaseFeedItem
                key={log.id}
                log={log}
                network={log.trackedWallet?.network ?? "ETHEREUM"}
              />
            ))}
          </div>
        )}

        {/* ── Wallets tab ── */}
        {activeTab === "wallets" && (
          <div className="space-y-2">
            {walletsLoading && (
              <Panel className="p-8 text-center text-sm" style={{ color: "var(--text-3)" }}>
                <Loader2 size={20} className="mx-auto mb-3 animate-spin" />
                Loading wallets…
              </Panel>
            )}

            {!walletsLoading && wallets.length === 0 && (
              <Panel>
                <div className="flex flex-col items-center px-6 py-12 text-center">
                  <div className="grid size-[52px] place-items-center rounded-full" style={{ background: "var(--surface-2)" }}>
                    <Wallet size={24} style={{ color: "var(--text-3)" }} />
                  </div>
                  <p className="mt-3 text-[13px] font-medium" style={{ color: "var(--text-2)" }}>
                    No wallets tracked yet
                  </p>
                  <p className="mt-1 text-[12px]" style={{ color: "var(--text-3)" }}>
                    Use the form above to add a wallet address with a nickname.
                  </p>
                </div>
              </Panel>
            )}

            {wallets.map((wallet) => (
              <WalletCard key={wallet.id} wallet={wallet} onRefresh={refresh} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
