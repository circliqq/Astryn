"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Send, XCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel, Select } from "@/components/ui";
import { apiFetch } from "@/lib/api";

interface Wallet {
  id: string;
  name: string;
  address: string;
  network: "BASE" | "ETHEREUM" | "ROBINHOOD";
  lastBalanceWei: string | null;
}

interface PreviewData {
  sender: { name: string; address: string; balanceEth: string; sufficientFunds: boolean };
  recipients: Array<{ id: string; name: string; address: string; currentBalanceEth: string; willReceiveEth: string }>;
  summary: { totalRequiredEth: string; senderCanAfford: boolean };
}

interface RecipientResult {
  walletId: string;
  address: string;
  amountEth: string;
  txHash: string;
  status: "sent" | "failed";
  error?: string;
}

function formatEth(wei: string | null) {
  if (!wei) return "0.0000";
  try {
    return (Number(BigInt(wei)) / 1e18).toFixed(4);
  } catch {
    return "0.0000";
  }
}

export default function DistributorPage() {
  const queryClient = useQueryClient();
  const [senderWalletId, setSenderWalletId] = useState("");
  const [amountEach, setAmountEach] = useState("0.05");
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [results, setResults] = useState<RecipientResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const { data: wallets = [], isLoading } = useQuery<Wallet[]>({
    queryKey: ["wallets"],
    queryFn: () => apiFetch<Wallet[]>("/wallets"),
  });

  useEffect(() => {
    if (!senderWalletId && wallets.length > 0) setSenderWalletId(wallets[0].id);
  }, [senderWalletId, wallets]);

  const sender = wallets.find((wallet) => wallet.id === senderWalletId);
  const recipients = wallets.filter((wallet) => selected.includes(wallet.id));
  const amount = Number(amountEach);
  const totalEth = Number.isFinite(amount) ? amount * recipients.length : 0;

  const compatibleRecipients = useMemo(() => {
    if (!sender) return wallets;
    return wallets.filter((wallet) => wallet.id !== sender.id && wallet.network === sender.network);
  }, [sender, wallets]);

  function toggleWallet(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
    setPreview(null);
    setResults([]);
  }

  async function handlePreview() {
    setLoading(true);
    setMessage(null);
    try {
      const data = await apiFetch<PreviewData>("/distributor/preview", {
        method: "POST",
        body: JSON.stringify({
          senderWalletId,
          recipientWalletIds: selected,
          amountEthEach: amountEach,
        }),
      });
      setPreview(data);
      setMessage(data.summary.senderCanAfford ? "Preview ready. Review before sending." : "Sender balance is not enough.");
    } catch (error) {
      setPreview(null);
      setMessage(error instanceof Error ? error.message : "Preview failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    if (!preview) {
      await handlePreview();
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const data = await apiFetch<{ results: RecipientResult[] }>("/distributor/send", {
        method: "POST",
        body: JSON.stringify({
          senderWalletId,
          recipients: selected.map((walletId) => ({ walletId, amountEth: amountEach })),
        }),
      });
      setResults(data.results);
      setPreview(null);
      await queryClient.invalidateQueries({ queryKey: ["wallets"] });
      setMessage(`${data.results.filter((item) => item.status === "sent").length} transfer(s) sent.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Send failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell title="ETH Distributor">
      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <Panel>
          <div className="panel-header">
            <div>
              <p className="text-[14px] font-semibold" style={{ color: "var(--text-1)" }}>Distribution Plan</p>
              <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-3)" }}>Fund multiple wallets from one source wallet.</p>
            </div>
            <Send size={17} style={{ color: "var(--text-3)" }} />
          </div>
          <div className="space-y-4 p-5">
            <label>
              <span className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-3)" }}>Sender wallet</span>
              <Select
                value={senderWalletId}
                onChange={(event) => { setSenderWalletId(event.target.value); setSelected([]); setPreview(null); }}
              >
                {wallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>{wallet.name} - {wallet.network}</option>
                ))}
              </Select>
            </label>
            <label>
              <span className="mb-1 block text-[11px] font-medium" style={{ color: "var(--text-3)" }}>Amount per recipient</span>
              <Input type="number" min="0" step="any" value={amountEach} onChange={(event) => { setAmountEach(event.target.value); setPreview(null); }} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div className="metric-card">
                <p className="label-caps">Recipients</p>
                <p className="metric-value">{selected.length}</p>
              </div>
              <div className="metric-card">
                <p className="label-caps">Total</p>
                <p className="metric-value text-[20px]">{totalEth.toFixed(4)}</p>
              </div>
            </div>
            {message && <p className="notice text-[12px]">{message}</p>}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={handlePreview} disabled={loading || selected.length === 0}>Preview</Button>
              <Button type="button" className="flex-1" onClick={handleSend} disabled={loading || selected.length === 0}>{loading ? "Working..." : "Send"}</Button>
            </div>
          </div>
        </Panel>

        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="metric-card"><p className="label-caps">Sender balance</p><p className="metric-value">{formatEth(sender?.lastBalanceWei ?? null)}</p></div>
            <div className="metric-card"><p className="label-caps">Network</p><p className="metric-value text-[20px]">{sender?.network === "ETHEREUM" ? "Ethereum" : sender?.network === "ROBINHOOD" ? "Robinhood" : "Base"}</p></div>
            <div className="metric-card"><p className="label-caps">Available wallets</p><p className="metric-value">{compatibleRecipients.length}</p></div>
          </div>

          <Panel>
            <div className="panel-header">
              <p className="text-[14px] font-semibold" style={{ color: "var(--text-1)" }}>Recipient Wallets</p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(compatibleRecipients.map((wallet) => wallet.id))}>Select all</Button>
            </div>
            {isLoading ? (
              <div className="empty-state">Loading wallets...</div>
            ) : compatibleRecipients.length === 0 ? (
              <div className="empty-state">No compatible recipient wallets found.</div>
            ) : (
              <div className="grid gap-2 p-5 md:grid-cols-2 xl:grid-cols-3">
                {compatibleRecipients.map((wallet) => {
                  const isSelected = selected.includes(wallet.id);
                  return (
                    <button
                      key={wallet.id}
                      type="button"
                      className="rounded-md border px-3 py-3 text-left transition-colors"
                      style={isSelected
                        ? { borderColor: "var(--brand)", background: "var(--brand-surface)" }
                        : { borderColor: "var(--border)", background: "var(--surface-2)" }}
                      onClick={() => toggleWallet(wallet.id)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium" style={{ color: "var(--text-1)" }}>{wallet.name}</span>
                        <Badge tone={isSelected ? "green" : "slate"}>{isSelected ? "Selected" : wallet.network}</Badge>
                      </div>
                      <p className="mt-1 font-mono text-[11px]" style={{ color: "var(--text-3)" }}>{wallet.address.slice(0, 12)}...</p>
                    </button>
                  );
                })}
              </div>
            )}
          </Panel>

          {preview && (
            <Panel>
              <div className="panel-header">
                <p className="text-[14px] font-semibold" style={{ color: "var(--text-1)" }}>Preview</p>
                <Badge tone={preview.summary.senderCanAfford ? "green" : "red"}>{preview.summary.senderCanAfford ? "Funded" : "Insufficient"}</Badge>
              </div>
              <div className="p-5 text-[13px]" style={{ color: "var(--text-2)" }}>
                Total required: <span className="font-mono" style={{ color: "var(--text-1)" }}>{preview.summary.totalRequiredEth} ETH</span>
              </div>
            </Panel>
          )}

          {results.length > 0 && (
            <Panel>
              <div className="panel-header">
                <p className="text-[14px] font-semibold" style={{ color: "var(--text-1)" }}>Transfer Results</p>
              </div>
              <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                {results.map((result) => (
                  <div key={result.walletId} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="flex items-center gap-2">
                      {result.status === "sent" ? <CheckCircle2 size={15} className="text-status-green-text" /> : <XCircle size={15} className="text-status-red-text" />}
                      <span className="font-mono text-[12px]" style={{ color: "var(--text-2)" }}>{result.address.slice(0, 12)}...</span>
                    </div>
                    <span className="text-[12px]" style={{ color: "var(--text-3)" }}>{result.error ?? result.txHash}</span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </AppShell>
  );
}
