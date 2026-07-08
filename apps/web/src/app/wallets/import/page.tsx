"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button, Input, Panel } from "@/components/ui";
import { apiFetch } from "@/lib/api";

interface WalletResponse {
  id: string;
  name: string;
  address: string;
}

function normalizePrivateKey(value: string): string | null {
  const trimmed = value.trim().replace(/\s+/g, "");
  const normalized = /^0x/i.test(trimmed) ? `0x${trimmed.slice(2)}` : `0x${trimmed}`;
  return /^0x[a-fA-F0-9]{64}$/.test(normalized) ? normalized : null;
}

export default function WalletImportPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [network, setNetwork] = useState<"base" | "ethereum" | "robinhood">("base");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const normalizedPrivateKey = normalizePrivateKey(privateKey);
    if (!normalizedPrivateKey) {
      setError("Private key must be 64 hex characters, with or without 0x.");
      return;
    }

    setLoading(true);
    try {
      await apiFetch<WalletResponse>("/wallets/import", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          privateKey: normalizedPrivateKey,
          network
        })
      });
      router.push("/wallets");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import wallet.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell title="Wallet Import">
      <Panel className="mx-auto max-w-xl p-6">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-md bg-emerald-300/10 text-status-green-text">
            <LockKeyhole size={18} />
          </div>
          <div>
            <h2 className="font-semibold">Import encrypted wallet</h2>
            <p className="text-sm text-graphite-400">Private keys are encrypted server-side before storage.</p>
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
          <Input
            className="w-full"
            placeholder="0x private key"
            type="password"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            required
          />
          <select
            className="h-10 w-full rounded-md border border-graphite-700 bg-graphite-950 px-3 text-sm"
            value={network}
            onChange={(e) => setNetwork(e.target.value as "base" | "ethereum" | "robinhood")}
          >
            <option value="base">Base</option>
            <option value="ethereum">Ethereum</option>
            <option value="robinhood">Robinhood</option>
          </select>
          {error && <p className="text-sm text-status-red-text">{error}</p>}
          <Button className="w-full" disabled={loading || !name.trim() || !privateKey.trim()}>
            {loading ? "Importing..." : "Encrypt & Import"}
          </Button>
        </form>
      </Panel>
    </AppShell>
  );
}
