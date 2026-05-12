"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, ShieldCheck, Upload } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { WalletTable } from "@/components/wallet-table";
import { Button, Input, Panel } from "@/components/ui";

export default function WalletsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  return (
    <AppShell title="Wallet Vault">
      <div className="space-y-5">
        <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div className="flex items-center gap-2 text-sm text-graphite-300">
            <ShieldCheck size={16} className="text-status-green-text" />
            Private keys are encrypted before storage.
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => router.push("/wallets/import")}>
              <Upload size={15} /> Import Wallet
            </Button>
            <Button type="button" variant="secondary" onClick={() => router.push("/wallets/create")}>
              <Plus size={15} /> Create Wallet
            </Button>
          </div>
        </div>
        <Panel className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-graphite-500" size={14} />
            <Input
              className="w-full pl-9"
              placeholder="Search wallet..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="h-8 rounded-md border border-graphite-700 bg-graphite-800 px-3 text-[13px] text-graphite-100 focus:border-brand focus:outline-none"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All Status</option>
            <option value="READY">Ready</option>
            <option value="LOW_BALANCE">Low Balance</option>
            <option value="NEED_FUNDING">Need Funding</option>
            <option value="NOT_ELIGIBLE">Not Eligible</option>
          </select>
        </Panel>
        <WalletTable search={search} status={status} />
      </div>
    </AppShell>
  );
}
