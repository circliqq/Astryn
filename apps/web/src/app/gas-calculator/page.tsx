"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calculator, Fuel, RefreshCw, Zap } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Button, Input, Panel, Select } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { gweiFromWei, type GasQuote } from "@/lib/gas-settings";

// ── Gas unit presets per contract type ───────────────────────────────────

const CONTRACT_TYPES = [
  { label: "ERC-721 (Standard Mint)",       units: 150_000 },
  { label: "SeaDrop / ERC-721C",            units: 210_000 },
  { label: "ERC-1155 (Multi-token)",        units: 120_000 },
  { label: "Allowlist / Merkle Mint",       units: 230_000 },
  { label: "Bundler (multi-wallet tx)",     units: 400_000 },
  { label: "Custom",                        units: 0       },
];

// ── Speed tiers ────────────────────────────────────────────────────────────

interface SpeedTier {
  key: string;
  label: string;
  baseMultiplier: number;   // × base fee
  priorityGwei: Record<"base" | "ethereum", number>;
  badge: "green" | "blue" | "yellow" | "red";
  description: string;
}

const SPEED_TIERS: SpeedTier[] = [
  {
    key: "safe",
    label: "Safe",
    baseMultiplier: 1.15,
    priorityGwei: { base: 0.001, ethereum: 0.05 },
    badge: "green",
    description: "Lands in ~30 s. Fine for low-competition mints.",
  },
  {
    key: "balanced",
    label: "Balanced",
    baseMultiplier: 1.5,
    priorityGwei: { base: 0.002, ethereum: 0.1 },
    badge: "blue",
    description: "Lands in ~12 s. Good for most drops.",
  },
  {
    key: "fast",
    label: "Fast",
    baseMultiplier: 2.0,
    priorityGwei: { base: 0.005, ethereum: 0.5 },
    badge: "yellow",
    description: "Lands in next 1-2 blocks. Use for hot mints.",
  },
  {
    key: "ultra",
    label: "Ultra-Fast",
    baseMultiplier: 3.0,
    priorityGwei: { base: 0.02, ethereum: 2.0 },
    badge: "red",
    description: "Frontrun priority. Use only for high-value drops.",
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt6(n: number) { return n.toFixed(6); }
function fmt4(n: number) { return n.toFixed(4); }
function fmtGwei(n: number) {
  if (n < 0.001) return n.toFixed(6);
  if (n < 1)     return n.toFixed(4);
  return n.toFixed(3);
}
function gasToEth(gasUnits: number, gwei: number) {
  return (gasUnits * gwei) / 1e9;
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function GasCalculatorPage() {
  const [network, setNetwork]             = useState<"base" | "ethereum">("ethereum");
  const [contractIdx, setContractIdx]     = useState(0);
  const [customUnits, setCustomUnits]     = useState("350000");
  const [walletCount, setWalletCount]     = useState("8");
  const [speedKey, setSpeedKey]           = useState("fast");

  // Manual gwei reverse-calc
  const [manualGwei, setManualGwei]       = useState("");
  // Reverse calc: target total ETH → required gwei
  const [targetEth, setTargetEth]         = useState("");

  // Live gas
  const { data: gas, dataUpdatedAt, refetch, isFetching } = useQuery<GasQuote>({
    queryKey: ["gas-current", network],
    queryFn: () => apiFetch<GasQuote>(`/gas/current?network=${network}`),
    refetchInterval: 10_000,
  });

  // ETH/USD price via CoinGecko (no key needed)
  const { data: ethUsd } = useQuery<number>({
    queryKey: ["eth-usd"],
    queryFn: async () => {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
      );
      const json = await res.json() as { ethereum?: { usd?: number } };
      return json?.ethereum?.usd ?? 0;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const baseGwei     = gweiFromWei(gas?.baseFeePerGas)     ?? 0;
  const priorityGwei = gweiFromWei(gas?.maxPriorityFeePerGas) ?? 0;

  const tier = SPEED_TIERS.find((t) => t.key === speedKey) ?? SPEED_TIERS[2];

  const gasUnits = useMemo(() => {
    if (CONTRACT_TYPES[contractIdx].units > 0) return CONTRACT_TYPES[contractIdx].units;
    const n = parseInt(customUnits, 10);
    return Number.isFinite(n) && n > 0 ? n : 350_000;
  }, [contractIdx, customUnits]);

  const wallets = Math.max(1, parseInt(walletCount, 10) || 1);

  // Calculated recommended gwei
  const recPriority = Math.max(tier.priorityGwei[network], priorityGwei * 1.1);
  const recMaxFee   = baseGwei * tier.baseMultiplier + recPriority;
  const effectiveGwei = Math.min(recMaxFee, baseGwei + recPriority);

  const ethPerWallet  = gasToEth(gasUnits, effectiveGwei);
  const ethTotal      = ethPerWallet * wallets;
  const maxEthPerWallet = gasToEth(gasUnits, recMaxFee);
  const maxEthTotal   = maxEthPerWallet * wallets;
  const usdPerWallet  = ethPerWallet * (ethUsd ?? 0);
  const usdTotal      = ethTotal * (ethUsd ?? 0);

  // Manual gwei section
  const manualGweiNum = parseFloat(manualGwei);
  const manualEthPer  = Number.isFinite(manualGweiNum) && manualGweiNum > 0
    ? gasToEth(gasUnits, manualGweiNum) : null;
  const manualEthTot  = manualEthPer !== null ? manualEthPer * wallets : null;
  const manualUsdPer  = manualEthPer !== null ? manualEthPer * (ethUsd ?? 0) : null;
  const manualUsdTot  = manualEthTot !== null ? manualEthTot * (ethUsd ?? 0) : null;
  const willLand      = manualGweiNum > 0 ? manualGweiNum >= recMaxFee : null;

  // Reverse calc: how much gwei to land within a target total ETH
  const targetEthNum  = parseFloat(targetEth);
  const reqGweiTotal  = Number.isFinite(targetEthNum) && targetEthNum > 0 && wallets > 0
    ? (targetEthNum * 1e9) / (gasUnits * wallets) : null;
  const reqGweiPer    = Number.isFinite(targetEthNum) && targetEthNum > 0
    ? (targetEthNum * 1e9) / gasUnits : null;

  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "—";

  return (
    <AppShell title="Gas Calculator">
      <div className="space-y-5">

        {/* ── Header metric cards ── */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="metric-card">
            <p className="label-caps">Live Base Fee</p>
            <p className="metric-value">{gas ? fmtGwei(baseGwei) : "—"} <span className="text-[13px] text-graphite-500">gwei</span></p>
          </div>
          <div className="metric-card">
            <p className="label-caps">Priority Fee</p>
            <p className="metric-value">{gas ? fmtGwei(priorityGwei) : "—"} <span className="text-[13px] text-graphite-500">gwei</span></p>
          </div>
          <div className="metric-card">
            <p className="label-caps">ETH / USD</p>
            <p className="metric-value">${ethUsd ? ethUsd.toLocaleString() : "—"}</p>
          </div>
          <div className="metric-card">
            <p className="label-caps">Network</p>
            <div className="mt-3">
              <Select
                value={network}
                onChange={(e) => setNetwork(e.target.value as "base" | "ethereum")}
              >
                <option value="ethereum">Ethereum</option>
                <option value="base">Base</option>
              </Select>
            </div>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1fr_380px]">

          {/* ── Left: inputs ── */}
          <div className="space-y-5">

            {/* Contract type */}
            <Panel>
              <div className="panel-header">
                <div>
                  <p className="text-[14px] font-semibold text-graphite-100">Transaction Type</p>
                  <p className="mt-0.5 text-[12px] text-graphite-500">Select the contract type to auto-fill gas units.</p>
                </div>
                <Calculator size={18} className="text-graphite-500" />
              </div>
              <div className="grid gap-2 p-5 sm:grid-cols-2 lg:grid-cols-3">
                {CONTRACT_TYPES.map((ct, i) => (
                  <button
                    key={ct.label}
                    type="button"
                    onClick={() => setContractIdx(i)}
                    className={`rounded-md border px-3 py-2.5 text-left text-[12px] transition-colors ${
                      contractIdx === i
                        ? "border-brand bg-brand/10 text-graphite-100"
                        : "border-graphite-700 bg-graphite-800 text-graphite-400 hover:border-graphite-600 hover:text-graphite-200"
                    }`}
                  >
                    <span className="block font-medium">{ct.label}</span>
                    <span className="mt-0.5 block text-[11px] text-graphite-500">
                      {ct.units > 0 ? `~${ct.units.toLocaleString()} gas` : "Custom"}
                    </span>
                  </button>
                ))}
              </div>
              {CONTRACT_TYPES[contractIdx].units === 0 && (
                <div className="border-t border-graphite-700 p-5">
                  <label>
                    <span className="mb-1 block text-[11px] font-medium text-graphite-400">Custom gas units</span>
                    <Input
                      type="number"
                      min="21000"
                      value={customUnits}
                      onChange={(e) => setCustomUnits(e.target.value)}
                      placeholder="e.g. 350000"
                    />
                  </label>
                </div>
              )}
            </Panel>

            {/* Speed tier */}
            <Panel>
              <div className="panel-header">
                <div>
                  <p className="text-[14px] font-semibold text-graphite-100">Target Speed</p>
                  <p className="mt-0.5 text-[12px] text-graphite-500">How fast do you need the transaction to land?</p>
                </div>
                <Zap size={18} className="text-graphite-500" />
              </div>
              <div className="grid gap-2 p-5 sm:grid-cols-2 lg:grid-cols-4">
                {SPEED_TIERS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setSpeedKey(t.key)}
                    className={`rounded-md border p-3 text-left transition-colors ${
                      speedKey === t.key
                        ? "border-brand bg-brand/10"
                        : "border-graphite-700 bg-graphite-800 hover:border-graphite-600"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-graphite-100">{t.label}</span>
                      <Badge tone={t.badge}>{t.key}</Badge>
                    </div>
                    <p className="mt-1.5 text-[11px] text-graphite-500">{t.description}</p>
                    <p className="mt-1.5 text-[11px] font-medium text-graphite-300">
                      {t.baseMultiplier}× base fee
                    </p>
                  </button>
                ))}
              </div>
            </Panel>

            {/* Wallet count */}
            <Panel>
              <div className="p-5">
                <label>
                  <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-graphite-500">Wallet count</span>
                  <Input
                    type="number"
                    min="1"
                    value={walletCount}
                    onChange={(e) => setWalletCount(e.target.value)}
                    className="max-w-[200px]"
                    placeholder="8"
                  />
                </label>
              </div>
            </Panel>

            {/* Manual gwei tester */}
            <Panel>
              <div className="panel-header">
                <div>
                  <p className="text-[14px] font-semibold text-graphite-100">Manual Gwei Tester</p>
                  <p className="mt-0.5 text-[12px] text-graphite-500">
                    Enter a gwei value to see exactly how much ETH / USDC it costs — and whether it will land.
                  </p>
                </div>
              </div>
              <div className="space-y-4 p-5">
                <div className="flex items-end gap-3">
                  <label className="flex-1">
                    <span className="mb-1 block text-[11px] font-medium text-graphite-400">Max fee (gwei)</span>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={manualGwei}
                      onChange={(e) => setManualGwei(e.target.value)}
                      placeholder={`e.g. ${fmtGwei(recMaxFee)}`}
                    />
                  </label>
                  {manualEthPer !== null && (
                    <div className={`rounded-md border px-3 py-2 text-[12px] font-medium ${
                      willLand
                        ? "border-status-green-border bg-status-green-bg text-status-green-text"
                        : "border-status-red-border bg-status-red-bg text-status-red-text"
                    }`}>
                      {willLand ? "✓ Will land" : "✗ Too low"}
                    </div>
                  )}
                </div>

                {manualEthPer !== null && (
                  <div className="grid gap-3 rounded-md border border-graphite-700 bg-graphite-800/60 p-4 sm:grid-cols-2">
                    <div>
                      <p className="label-caps">Cost per wallet</p>
                      <p className="mt-1 text-[15px] font-semibold text-graphite-100">{fmt6(manualEthPer)} ETH</p>
                      {ethUsd ? <p className="mt-0.5 text-[12px] text-graphite-500">${(manualUsdPer ?? 0).toFixed(4)} USD</p> : null}
                    </div>
                    <div>
                      <p className="label-caps">Total ({wallets} wallets)</p>
                      <p className="mt-1 text-[15px] font-semibold text-graphite-100">{fmt6(manualEthTot!)} ETH</p>
                      {ethUsd ? <p className="mt-0.5 text-[12px] text-graphite-500">${(manualUsdTot ?? 0).toFixed(4)} USD</p> : null}
                    </div>
                    <div>
                      <p className="label-caps">Min needed to land</p>
                      <p className="mt-1 text-[13px] font-medium text-graphite-100">{fmtGwei(recMaxFee)} gwei</p>
                    </div>
                    <div>
                      <p className="label-caps">Difference</p>
                      <p className={`mt-1 text-[13px] font-medium ${manualGweiNum >= recMaxFee ? "text-status-green-text" : "text-status-red-text"}`}>
                        {manualGweiNum >= recMaxFee
                          ? `+${fmtGwei(manualGweiNum - recMaxFee)} gwei surplus`
                          : `${fmtGwei(recMaxFee - manualGweiNum)} gwei short`}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </Panel>

            {/* Reverse calc */}
            <Panel>
              <div className="panel-header">
                <div>
                  <p className="text-[14px] font-semibold text-graphite-100">Reverse Calculator</p>
                  <p className="mt-0.5 text-[12px] text-graphite-500">
                    Enter your max total ETH budget → get the max gwei you can afford.
                  </p>
                </div>
              </div>
              <div className="space-y-4 p-5">
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">Max total ETH budget (all wallets)</span>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={targetEth}
                    onChange={(e) => setTargetEth(e.target.value)}
                    placeholder="e.g. 0.01"
                    className="max-w-[240px]"
                  />
                </label>

                {reqGweiTotal !== null && (
                  <div className="grid gap-3 rounded-md border border-graphite-700 bg-graphite-800/60 p-4 sm:grid-cols-3">
                    <div>
                      <p className="label-caps">Max gwei (total budget)</p>
                      <p className="mt-1 text-[15px] font-semibold text-graphite-100">{fmtGwei(reqGweiTotal)}</p>
                      <p className="mt-0.5 text-[11px] text-graphite-500">across {wallets} wallets</p>
                    </div>
                    <div>
                      <p className="label-caps">Max gwei per wallet</p>
                      <p className="mt-1 text-[15px] font-semibold text-graphite-100">{fmtGwei(reqGweiPer!)}</p>
                      <p className="mt-0.5 text-[11px] text-graphite-500">per wallet</p>
                    </div>
                    <div>
                      <p className="label-caps">Landing confidence</p>
                      <p className={`mt-1 text-[13px] font-semibold ${
                        reqGweiPer! >= recMaxFee
                          ? "text-status-green-text"
                          : reqGweiPer! >= recMaxFee * 0.8
                          ? "text-yellow-400"
                          : "text-status-red-text"
                      }`}>
                        {reqGweiPer! >= recMaxFee ? "✓ Will land" : reqGweiPer! >= recMaxFee * 0.8 ? "⚠ Borderline" : "✗ Too low"}
                      </p>
                      <p className="mt-0.5 text-[11px] text-graphite-500">needs {fmtGwei(recMaxFee)} gwei to land</p>
                    </div>
                  </div>
                )}
              </div>
            </Panel>
          </div>

          {/* ── Right: results ── */}
          <div className="space-y-5">
            <Panel>
              <div className="panel-header">
                <div>
                  <p className="text-[14px] font-semibold text-graphite-100">Recommended Settings</p>
                  <p className="mt-0.5 text-[12px] text-graphite-500">
                    For <span className="text-graphite-300">{tier.label}</span> speed on {network === "base" ? "Base" : "Ethereum"}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="flex items-center gap-1 text-[11px] text-graphite-500 hover:text-graphite-300"
                >
                  <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
                  {lastUpdate}
                </button>
              </div>
              <div className="space-y-3 p-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-graphite-700 bg-graphite-800 p-3">
                    <p className="label-caps">Max Fee</p>
                    <p className="mt-1 text-[18px] font-bold text-graphite-100">{gas ? fmtGwei(recMaxFee) : "—"}</p>
                    <p className="text-[11px] text-graphite-500">gwei</p>
                  </div>
                  <div className="rounded-md border border-graphite-700 bg-graphite-800 p-3">
                    <p className="label-caps">Priority Fee</p>
                    <p className="mt-1 text-[18px] font-bold text-graphite-100">{gas ? fmtGwei(recPriority) : "—"}</p>
                    <p className="text-[11px] text-graphite-500">gwei</p>
                  </div>
                </div>

                <div className="rounded-md border border-graphite-700 bg-graphite-800 p-3">
                  <p className="label-caps">Gas Units</p>
                  <p className="mt-1 text-[15px] font-semibold text-graphite-100">{gasUnits.toLocaleString()}</p>
                  <p className="text-[11px] text-graphite-500">{CONTRACT_TYPES[contractIdx].label}</p>
                </div>
              </div>

              <div className="border-t border-graphite-700 p-5 space-y-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-graphite-500">Cost breakdown</p>

                <div className="space-y-2 text-[13px]">
                  <div className="flex justify-between">
                    <span className="text-graphite-500">Est. cost / wallet</span>
                    <span className="font-medium text-graphite-100">{gas ? fmt6(ethPerWallet) : "—"} ETH</span>
                  </div>
                  {ethUsd ? (
                    <div className="flex justify-between">
                      <span className="text-graphite-500">≈ USD / wallet</span>
                      <span className="font-medium text-graphite-100">${usdPerWallet.toFixed(4)}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between">
                    <span className="text-graphite-500">Max cap / wallet</span>
                    <span className="text-graphite-400">{gas ? fmt6(maxEthPerWallet) : "—"} ETH</span>
                  </div>
                </div>

                <div className="border-t border-graphite-700 pt-3 space-y-2 text-[13px]">
                  <div className="flex justify-between">
                    <span className="text-graphite-500">Wallets</span>
                    <span className="text-graphite-300">{wallets}</span>
                  </div>
                  <div className="flex justify-between text-[14px] font-bold text-graphite-100">
                    <span>Total ETH</span>
                    <span>{gas ? fmt6(ethTotal) : "—"} ETH</span>
                  </div>
                  {ethUsd ? (
                    <div className="flex justify-between text-[14px] font-bold text-graphite-100">
                      <span>Total USD</span>
                      <span>${usdTotal.toFixed(4)}</span>
                    </div>
                  ) : null}
                  <div className="flex justify-between">
                    <span className="text-graphite-500">Max total cap</span>
                    <span className="text-graphite-400">{gas ? fmt4(maxEthTotal) : "—"} ETH</span>
                  </div>
                </div>
              </div>
            </Panel>

            {/* Speed comparison table */}
            <Panel>
              <div className="panel-header">
                <p className="text-[14px] font-semibold text-graphite-100">Speed Comparison</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-graphite-700 text-left text-graphite-500">
                      <th className="px-4 py-2">Speed</th>
                      <th className="px-4 py-2">Max Fee</th>
                      <th className="px-4 py-2">ETH/wallet</th>
                      {ethUsd ? <th className="px-4 py-2">USD/wallet</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {SPEED_TIERS.map((t) => {
                      const tPriority = Math.max(t.priorityGwei[network], priorityGwei * 1.1);
                      const tMax = baseGwei * t.baseMultiplier + tPriority;
                      const tEff = Math.min(tMax, baseGwei + tPriority);
                      const tEth = gasToEth(gasUnits, tEff);
                      const tUsd = tEth * (ethUsd ?? 0);
                      const active = t.key === speedKey;
                      return (
                        <tr
                          key={t.key}
                          className={`border-b border-graphite-700/50 cursor-pointer transition-colors ${active ? "bg-brand/5" : "hover:bg-graphite-800/40"}`}
                          onClick={() => setSpeedKey(t.key)}
                        >
                          <td className="px-4 py-2.5">
                            <Badge tone={t.badge}>{t.label}</Badge>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-graphite-100">{gas ? fmtGwei(tMax) : "—"}</td>
                          <td className="px-4 py-2.5 font-mono text-graphite-100">{gas ? fmt6(tEth) : "—"}</td>
                          {ethUsd ? <td className="px-4 py-2.5 font-mono text-graphite-100">${tUsd.toFixed(4)}</td> : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
