"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button, Input, Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";

interface WalletResponse {
  id: string;
  name: string;
  address: string;
}

export default function WalletCreatePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [network, setNetwork] = useState<"base" | "ethereum">("base");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await apiFetch<WalletResponse>("/wallets/create", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          network
        })
      });
      router.push("/wallets");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create wallet.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell title="Create Wallet">
      <Panel className="mx-auto max-w-xl p-6">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-md bg-cyan-300/10 text-brand">
            <Plus size={18} />
          </div>
          <div>
            <h2 className="font-semibold">Create a new wallet</h2>
            <p className="text-sm text-graphite-400">
              A new private key will be generated and encrypted before storage.
            </p>
          </div>
        </div>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <Input
            className="w-full"
            placeholder="Wallet name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <select
            className="h-10 w-full rounded-md border border-graphite-700 bg-graphite-950 px-3 text-sm"
            value={network}
            onChange={(e) => setNetwork(e.target.value as "base" | "ethereum")}
          >
            <option value="base">Base</option>
            <option value="ethereum">Ethereum</option>
          </select>
          {error && <p className="text-sm text-status-red-text">{error}</p>}
          <Button className="w-full" disabled={loading || !name.trim()}>
            {loading ? "Creating..." : "Generate & Save Wallet"}
          </Button>
        </form>
      </Panel>
    </AppShell>
  );
}
