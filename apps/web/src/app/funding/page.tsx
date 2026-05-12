"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Coins, Send } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button, Input, Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";

interface Wallet {
  id: string;
  name: string;
  network: "BASE" | "ETHEREUM";
  status: string;
  lastBalanceWei: string | null;
}

interface FundingItem {
  walletId: string;
  address: string;
  requiredWei: string;
  reason: string;
}

interface FundingResult {
  items: FundingItem[];
  totalRequiredWei: string;
}

export default function FundingPage() {
  const [requiredEth, setRequiredEth] = useState("0.08");

  const { data: wallets = [], isLoading } = useQuery<Wallet[]>({
    queryKey: ["wallets"],
    queryFn: () => apiFetch<Wallet[]>("/wallets"),
  });

  const needFunding = wallets.filter((w) => w.status === "NEED_FUNDING" || w.status === "LOW_BALANCE");

  const { data: funding, mutate: calculate, isPending } = useMutation<FundingResult, Error, void>({
    mutationFn: () =>
      apiFetch<FundingResult>("/funding/calculate", {
        method: "POST",
        body: JSON.stringify({
          walletIds: needFunding.map((w) => w.id),
          requiredWeiPerWallet: String(Math.floor(parseFloat(requiredEth || "0") * 1e18)),
          network: needFunding[0].network ?? "BASE",
        }),
      }),
  });

  const { mutate: createPlan, isPending: creating } = useMutation<unknown, Error, void>({
    mutationFn: () =>
      apiFetch("/funding/create-plan", {
        method: "POST",
        body: JSON.stringify({
          walletIds: needFunding.map((w) => w.id),
          requiredWeiPerWallet: String(Math.floor(parseFloat(requiredEth || "0") * 1e18)),
          network: needFunding[0].network ?? "BASE",
        }),
      }),
  });

  const totalEth = funding?.totalRequiredWei && funding.totalRequiredWei !== "0"
    ? (Number(BigInt(funding.totalRequiredWei)) / 1e18).toFixed(4)
    : "0.0000";

  const displayItems = funding?.items ?? needFunding.map((w) => ({
    walletId: w.id,
    address: "",
    requiredWei: "0",
    reason: w.status === "NEED_FUNDING" ? "Needs funding" : "Low balance",
  }));

  return (
    <AppShell title="Funding Assistant">
      <div className="space-y-5">
        <Panel className="flex flex-col gap-3 p-5 md:flex-row md:items-end">
          <label className="flex-1">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-graphite-500">Required ETH per wallet (mint price + gas buffer)</p>
            <Input
              className="w-40"
              type="number"
              step="0.001"
              min="0"
              value={requiredEth}
              onChange={(e) => setRequiredEth(e.target.value)}
            />
          </label>
          <Button
            onClick={() => calculate()}
            disabled={isPending || needFunding.length === 0}
          >
            {isPending ? "Calculating..." : "Calculate Funding"}
          </Button>
        </Panel>

        <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <Panel className="p-5">
            <div className="flex items-center gap-2.5">
              <Coins size={15} className="text-status-green-text" />
              <h2 className="text-[13px] font-semibold text-graphite-100">Smart Funding Plan</h2>
            </div>
            {isLoading ? (
              <p className="mt-4 text-[13px] text-graphite-400">Loading wallets…</p>
            ) : needFunding.length === 0 ? (
              <div className="mt-6 flex items-center gap-2 text-[13px] text-status-green-text">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden><circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5"/><path d="M4.5 7l2 2 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                All wallets are sufficiently funded.
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {displayItems.map((item) => {
                  const wallet = wallets.find((w) => w.id === item.walletId);
                  const ethNeeded = item.requiredWei !== "0"
                    ? `${(Number(BigInt(item.requiredWei)) / 1e18).toFixed(4)} ETH`
                    : "Funded";
                  return (
                    <div
                      key={item.walletId}
                      className="flex items-center justify-between rounded-md border border-graphite-700 bg-graphite-800 px-4 py-3"
                    >
                      <div>
                        <p className="text-[13px] font-medium text-graphite-100">{wallet?.name ?? item.walletId.slice(0, 8)}</p>
                        <p className="mt-0.5 text-[11px] text-graphite-500">{item.reason}</p>
                      </div>
                      <span className="font-mono text-[13px] text-status-green-text">{ethNeeded}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel className="p-5">
            <h2 className="text-[13px] font-semibold text-graphite-100">Execution Guardrails</h2>
            <p className="mt-3 text-[13px] leading-6 text-graphite-400">
              Funding execution is separated from mint execution and requires explicit treasury wallet
              approval. Plans remain reviewable before any transaction is signed.
            </p>
            <div className="mt-6 rounded-md border border-graphite-700 bg-graphite-800 p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-graphite-500">Total required</p>
              <p className="mt-2 text-[28px] font-semibold tabular-nums leading-none text-graphite-100">{totalEth} <span className="text-[14px] font-normal text-graphite-400">ETH</span></p>
            </div>
            <Button
              className="mt-6 w-full"
              onClick={() => createPlan()}
              disabled={creating || needFunding.length === 0}
            >
              <Send size={15} /> Create Funding Plan
            </Button>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
