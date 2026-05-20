"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit, RefreshCw, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { StatusPill } from "./status-pill";
import { Badge, Button, Input, Panel, Select } from "./ui";

interface Wallet {
  id: string;
  name: string;
  address: string;
  network: "BASE" | "ETHEREUM";
  status: string;
  lastBalanceWei: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  READY: "Ready",
  LOW_BALANCE: "Low Balance",
  NEED_FUNDING: "Need Funding",
  NOT_ELIGIBLE: "Not Eligible",
  NONCE_ISSUE: "Nonce Issue",
};

function fmtEth(wei: string | null): string {
  if (!wei || wei === "0") return "0.000 ETH";
  return `${(Number(wei) / 1e18).toFixed(3)} ETH`;
}

export function WalletTable({ search, status }: { search: string; status: string }) {
  const queryClient = useQueryClient();
  const [editingWallet, setEditingWallet] = useState<Wallet | null>(null);
  const [editName, setEditName] = useState("");
  const [editNetwork, setEditNetwork] = useState<"base" | "ethereum">("base");
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const qs = new URLSearchParams();
  if (search) qs.set("search", search);
  if (status) qs.set("status", status);
  const query = qs.toString() ? `${qs.toString()}` : "";

  const { data: wallets = [], isLoading, error } = useQuery<Wallet[]>({
    queryKey: ["wallets", search, status],
    queryFn: () => apiFetch<Wallet[]>(`/wallets${query}`),
  });

  const updateWallet = useMutation({
    mutationFn: (payload: { id: string; name: string; network: "base" | "ethereum" }) =>
      apiFetch<Wallet>(`/wallets/${payload.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: payload.name,
          network: payload.network
        })
      }),
    onSuccess: async () => {
      setEditingWallet(null);
      setNotice("Wallet updated.");
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["wallets"] });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Failed to update wallet.");
    }
  });

  const refreshBalance = useMutation({
    mutationFn: (wallet: Wallet) =>
      apiFetch<{ balanceWei: string }>(`/wallets/${wallet.id}/balance`),
    onSuccess: async (_, wallet) => {
      setNotice(`${wallet.name} balance refreshed.`);
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["wallets"] });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Failed to refresh balance.");
    }
  });

  const deleteWallet = useMutation({
    mutationFn: (wallet: Wallet) =>
      apiFetch<{ count: number }>(`/wallets/${wallet.id}`, { method: "DELETE" }),
    onSuccess: async (data, wallet) => {
      if (data.count === 0) {
        setActionError("Wallet was not found.");
        setNotice(null);
      } else {
        setNotice(`${wallet.name} deleted.`);
        setActionError(null);
      }
      await queryClient.invalidateQueries({ queryKey: ["wallets"] });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "Failed to delete wallet.");
    }
  });

  function openEdit(wallet: Wallet) {
    setEditingWallet(wallet);
    setEditName(wallet.name);
    setEditNetwork(wallet.network === "BASE" ? "base" : "ethereum");
    setNotice(null);
    setActionError(null);
  }

  function handleEditSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editingWallet || !editName.trim()) return;
    updateWallet.mutate({
      id: editingWallet.id,
      name: editName.trim(),
      network: editNetwork
    });
  }

  function handleDelete(wallet: Wallet) {
    const confirmed = window.confirm(`Delete ${wallet.name} This removes it from your wallet vault.`);
    if (!confirmed) return;
    deleteWallet.mutate(wallet);
  }

  if (isLoading) {
    return <Panel className="p-6 text-[13px]" style={{ color: "var(--text-3)" }}>Loading wallets...</Panel>;
  }
  if (error) {
    return <Panel className="p-6 text-[13px] text-status-red-text">Failed to load wallets.</Panel>;
  }
  if (!wallets.length) {
    return (
      <Panel>
        <div className="flex flex-col items-center px-6 py-12 text-center">
          <div className="grid size-[52px] place-items-center rounded-full" style={{ background: "var(--surface-2)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-3)" }}><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-4 0v2"/></svg>
          </div>
          <p className="mt-3 text-[13px] font-medium" style={{ color: "var(--text-2)" }}>No wallets found</p>
          <p className="mt-1 text-[12px]" style={{ color: "var(--text-3)" }}>Import or create a wallet to get started.</p>
        </div>
      </Panel>
    );
  }

  return (
    <>
      {(notice || actionError) && (
        <Panel className="mb-3 flex items-center justify-between gap-3 p-3 text-sm">
          <span className={actionError ? "text-status-red-text" : "text-status-green-text"}>
            {actionError ?? notice}
          </span>
          <button
            type="button"
            style={{ color: "var(--text-3)" }}
            className="hover:opacity-80 transition-opacity"
            onClick={() => {
              setNotice(null);
              setActionError(null);
            }}
            aria-label="Dismiss message"
          >
            <X size={15} />
          </button>
        </Panel>
      )}

      <Panel>
        <div className="overflow-x-auto">
          <table className="data-table w-full min-w-[780px] text-left">
            <thead>
              <tr>
                {["Wallet", "Address", "Network", "Balance", "Status", "Actions"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wallets.map((wallet) => {
                const isRefreshing = refreshBalance.isPending && refreshBalance.variables.id === wallet.id;
                const isDeleting = deleteWallet.isPending && deleteWallet.variables.id === wallet.id;
                return (
                  <tr key={wallet.id}>
                    <td className="font-medium">{wallet.name}</td>
                    <td className="font-mono text-[11px]" style={{ color: "var(--text-3)" }} data-wallet-address>{wallet.address}</td>
                    <td style={{ color: "var(--text-2)" }}>
                      {wallet.network === "BASE" ? "Base" : "Ethereum"}
                    </td>
                    <td data-wallet-balance>{fmtEth(wallet.lastBalanceWei)}</td>
                    <td>
                      <StatusPill status={STATUS_LABEL[wallet.status] ?? wallet.status} />
                    </td>
                    <td>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          className="size-8 px-0"
                          aria-label={`Edit ${wallet.name}`}
                          title="Edit wallet"
                          onClick={() => openEdit(wallet)}
                          disabled={updateWallet.isPending || isDeleting}
                        >
                          <Edit size={14} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="size-8 px-0"
                          aria-label={`Refresh ${wallet.name} balance`}
                          title="Refresh balance"
                          onClick={() => refreshBalance.mutate(wallet)}
                          disabled={isRefreshing || isDeleting}
                        >
                          <RefreshCw size={14} className={isRefreshing ? "animate-spin" : undefined} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          className="size-8 px-0 text-status-red-text hover:bg-status-red-bg"
                          aria-label={`Delete ${wallet.name}`}
                          title="Delete wallet"
                          onClick={() => handleDelete(wallet)}
                          disabled={deleteWallet.isPending || isRefreshing}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {editingWallet && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-[10px] border p-5" style={{ background: "var(--surface)", borderColor: "var(--border-2)" }}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Edit Wallet</h2>
                <p className="mt-1 font-mono text-xs" style={{ color: "var(--text-3)" }} data-wallet-address>{editingWallet.address}</p>
              </div>
              <Badge tone="blue">{editingWallet.network === "BASE" ? "Base" : "Ethereum"}</Badge>
            </div>
            <form className="mt-5 space-y-4" onSubmit={handleEditSubmit}>
              <Input
                className="w-full"
                placeholder="Wallet name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                required
              />
              <Select
                value={editNetwork}
                onChange={(e) => setEditNetwork(e.target.value as "base" | "ethereum")}
              >
                <option value="base">Base</option>
                <option value="ethereum">Ethereum</option>
              </Select>
              {actionError && <p className="text-[12px] text-status-red-text">{actionError}</p>}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setEditingWallet(null)}
                  disabled={updateWallet.isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={updateWallet.isPending || !editName.trim()}>
                  {updateWallet.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
