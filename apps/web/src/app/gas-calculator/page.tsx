"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calculator, RefreshCw, Wallet, Zap } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge, Input, Panel, Select } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { gweiFromWei, type GasQuote } from "@/lib/gas-settings";

// ── Constants ─────────────────────────────────────────────────────────────

const CONTRACT_TYPES = [
  { label: "ERC-721 (Standard)",     units: 150_000 },
  { label: "SeaDrop / ERC-721C",     units: 210_000 },
  { label: "ERC-1155",               units: 120_000 },
  { label: "Allowlist / Merkle",     units: 230_000 },
  { label: "Bundler (multi-wallet)", units: 400_000 },
  { label: "Custom",                 units: 0       },
];

const SPEED_TIERS = [
  { key: "safe",     label: "Safe",       baseMul: 1.15, priBase: { base: 0.001, ethereum: 0.05  }, badge: "green"  as const },
  { key: "balanced", label: "Balanced",   baseMul: 1.5,  priBase: { base: 0.002, ethereum: 0.1   }, badge: "blue"   as const },
  { key: "fast",     label: "Fast",       baseMul: 2.0,  priBase: { base: 0.005, ethereum: 0.5   }, badge: "yellow" as const },
  { key: "ultra",    label: "Ultra-Fast", baseMul: 3.0,  priBase: { base: 0.02,  ethereum: 2.0   }, badge: "red"    as const },
];

// ── Helpers ───────────────────────────────────────────────────────────────

const f6      = (n: number) => n.toFixed(6);
const f4      = (n: number) => n.toFixed(4);
const f2      = (n: number) => n.toFixed(2);
const fg      = (n: number) => n < 0.001 ? n.toFixed(6) : n < 1 ? n.toFixed(4) : n.toFixed(3);
const gas2eth = (units: number, gwei: number) => (units * gwei) / 1e9;
const eth2usd = (eth: number, price: number) => eth * price;

function num(s: string, fallback = 0) {
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ── Sub-components ────────────────────────────────────────────────────────

function Row({ label, eth, usd, highlight }: { label: string; eth: string; usd: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-md px-3 py-2.5 ${highlight ? "bg-graphite-700/60" : "bg-graphite-800/40"}`}>
      <span className={`text-[12px] ${highlight ? "font-semibold text-graphite-100" : "text-graphite-400"}`}>{label}</span>
      <div className="text-right">
        <p className={`font-mono text-[13px] ${highlight ? "font-bold text-graphite-100" : "text-graphite-200"}`}>{eth} ETH</p>
        <p className="font-mono text-[11px] text-graphite-500">{usd} USDT</p>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function GasCalculatorPage() {
  // Inputs
  const [network,       setNetwork]       = useState<"base" | "ethereum">("ethereum");
  const [contractIdx,   setContractIdx]   = useState(0);
  const [customUnits,   setCustomUnits]   = useState("350000");
  const [walletCount,   setWalletCount]   = useState("8");
  const [qtyPerWallet,  setQtyPerWallet]  = useState("1");
  const [mintPriceEth,  setMintPriceEth]  = useState("0");
  const [speedKey,      setSpeedKey]      = useState("fast");
  const [manualGwei,    setManualGwei]    = useState("");
  // Wallet balance checker
  const [walletBalance,    setWalletBalance]    = useState("");
  const [balanceMode,      setBalanceMode]      = useState<"full" | "gas">("full");

  // Live gas
  const { data: gas, dataUpdatedAt, refetch, isFetching } = useQuery<GasQuote>({
    queryKey: ["gas-current", network],
    queryFn:  () => apiFetch<GasQuote>(`/gas/current?network=${network}`),
    refetchInterval: 10_000,
  });

  // ETH/USD price
  const { data: ethUsd = 0 } = useQuery<number>({
    queryKey: ["eth-usd"],
    queryFn: async () => {
      const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
      const j   = await res.json() as { ethereum?: { usd?: number } };
      return j?.ethereum?.usd ?? 0;
    },
    refetchInterval: 60_000,
    staleTime:       30_000,
  });

  // Live gas numbers
  const baseGwei = gweiFromWei(gas?.baseFeePerGas)        ?? 0;
  const liveP    = gweiFromWei(gas?.maxPriorityFeePerGas) ?? 0;
  const hasGas   = baseGwei > 0;

  // Active speed tier
  const tier = SPEED_TIERS.find(t => t.key === speedKey) ?? SPEED_TIERS[2];

  // Gas units
  const gasUnits = useMemo(() => {
    if (CONTRACT_TYPES[contractIdx].units > 0) return CONTRACT_TYPES[contractIdx].units;
    const n = parseInt(customUnits, 10);
    return Number.isFinite(n) && n > 21_000 ? n : 350_000;
  }, [contractIdx, customUnits]);

  // Parsed inputs
  const wallets   = Math.max(1, parseInt(walletCount,  10) || 1);
  const qty       = Math.max(1, parseInt(qtyPerWallet, 10) || 1);
  const mintPrice = num(mintPriceEth, 0);
  const balanceEth = num(walletBalance, -1); // -1 = not entered

  // ── Recommended gwei (speed tier) ────────────────────────────────────────
  const recPri    = Math.max(tier.priBase[network], liveP * 1.1);
  const recMax    = baseGwei * tier.baseMul + recPri;
  const effective = Math.min(recMax, baseGwei + recPri);

  // Manual override
  const manualG = num(manualGwei);
  const useGwei = manualG > 0 ? manualG : (hasGas ? effective : 0);
  const capGwei = manualG > 0 ? manualG : (hasGas ? recMax    : 0);

  // ── Per-wallet cost ───────────────────────────────────────────────────────
  const gasEthPer   = gas2eth(gasUnits, useGwei);
  const gasCapPer   = gas2eth(gasUnits, capGwei);
  const mintEthPer  = mintPrice * qty;
  const totalEthPer = gasEthPer  + mintEthPer;
  const totalCapPer = gasCapPer  + mintEthPer;

  // ── All-wallet totals ─────────────────────────────────────────────────────
  const gasEthAll   = gasEthPer  * wallets;
  const mintEthAll  = mintEthPer * wallets;
  const totalEthAll = totalEthPer * wallets;
  const totalCapAll = totalCapPer * wallets;

  // USD
  const gasUsdPer   = eth2usd(gasEthPer,   ethUsd);
  const mintUsdPer  = eth2usd(mintEthPer,  ethUsd);
  const totalUsdPer = eth2usd(totalEthPer, ethUsd);
  const gasUsdAll   = eth2usd(gasEthAll,   ethUsd);
  const mintUsdAll  = eth2usd(mintEthAll,  ethUsd);
  const totalUsdAll = eth2usd(totalEthAll, ethUsd);
  const totalCapUsd = eth2usd(totalCapAll, ethUsd);

  // ── Wallet balance checker ────────────────────────────────────────────────
  const balanceEntered = balanceEth >= 0;
  // In "full" mode: subtract mint fee from balance to get gas budget.
  // In "gas" mode: the entered value IS the gas budget — mint fee not included.
  const remainingForGas = balanceEntered
    ? balanceMode === "full"
      ? Math.max(0, balanceEth - mintEthPer)
      : balanceEth
    : 0;
  // Max gwei this balance can afford for gas
  const maxAffordableGwei = balanceEntered && gasUnits > 0
    ? (remainingForGas * 1e9) / gasUnits
    : 0;
  // Can we afford the mint fee at all? (only relevant in full-balance mode)
  const canAffordMint = balanceEntered && balanceMode === "full"
    ? balanceEth >= mintEthPer
    : null;
  // Tier affordability
  const tierAffordability = SPEED_TIERS.map(t => {
    const tP    = Math.max(t.priBase[network], liveP * 1.1);
    const tMax  = baseGwei * t.baseMul + tP;
    const tEff  = Math.min(tMax, baseGwei + tP);
    const tCost = gas2eth(gasUnits, tEff) + mintEthPer;
    const canAfford = balanceEntered ? balanceEth >= tCost : null;
    const gweiOk    = balanceEntered ? maxAffordableGwei >= tMax : null;
    return { ...t, tMax, tEff, tCost, canAfford, gweiOk };
  });
  // Best tier the wallet can afford
  const bestAffordableTier = [...tierAffordability].reverse().find(t => t.canAfford === true) ?? null;
  // Shortfall
  const shortfall = balanceEntered && canAffordMint === false
    ? mintEthPer - balanceEth
    : balanceEntered && bestAffordableTier === null && hasGas
    ? tierAffordability[0].tCost - balanceEth
    : null;

  // Landing check for manual gwei
  const willLand = manualG > 0 ? manualG >= recMax : null;

  const lastUpdate = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "—";

  return (
    <AppShell title="Gas Calculator">
      <div className="grid gap-5 xl:grid-cols-[1fr_400px]">

        {/* ══════════════════ LEFT ══════════════════ */}
        <div className="space-y-4">

          {/* Live metrics */}
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="metric-card">
              <p className="label-caps">Base Fee</p>
              <p className="metric-value text-[16px]">{hasGas ? fg(baseGwei) : "—"} <span className="text-[11px] text-graphite-500">gwei</span></p>
            </div>
            <div className="metric-card">
              <p className="label-caps">Priority</p>
              <p className="metric-value text-[16px]">{hasGas ? fg(liveP) : "—"} <span className="text-[11px] text-graphite-500">gwei</span></p>
            </div>
            <div className="metric-card">
              <p className="label-caps">ETH price</p>
              <p className="metric-value text-[16px]">${ethUsd ? ethUsd.toLocaleString() : "—"}</p>
            </div>
            <div className="metric-card">
              <p className="label-caps">Network</p>
              <div className="mt-2">
                <Select value={network} onChange={e => setNetwork(e.target.value as "base" | "ethereum")}>
                  <option value="ethereum">Ethereum</option>
                  <option value="base">Base</option>
                </Select>
              </div>
            </div>
          </div>

          {/* Mint details */}
          <Panel>
            <div className="panel-header">
              <div>
                <p className="text-[14px] font-semibold text-graphite-100">Mint Details</p>
                <p className="mt-0.5 text-[12px] text-graphite-500">Wallet count, mint price, and quantity per wallet.</p>
              </div>
              <Calculator size={18} className="text-graphite-500" />
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-3">
              <label>
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-graphite-500">Wallets</span>
                <Input type="number" min="1" value={walletCount} onChange={e => setWalletCount(e.target.value)} placeholder="8" />
                <p className="mt-1 text-[11px] text-graphite-500">How many wallets minting</p>
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-graphite-500">Mint Price (ETH)</span>
                <Input type="number" min="0" step="any" value={mintPriceEth} onChange={e => setMintPriceEth(e.target.value)} placeholder="0.05" />
                <p className="mt-1 text-[11px] text-graphite-500">NFT price per mint</p>
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-graphite-500">Qty per Wallet</span>
                <Input type="number" min="1" value={qtyPerWallet} onChange={e => setQtyPerWallet(e.target.value)} placeholder="1" />
                <p className="mt-1 text-[11px] text-graphite-500">NFTs to mint per wallet</p>
              </label>
            </div>
          </Panel>

          {/* Contract type */}
          <Panel>
            <div className="panel-header">
              <p className="text-[14px] font-semibold text-graphite-100">Contract Type</p>
              <p className="text-[12px] text-graphite-500">Determines gas units used</p>
            </div>
            <div className="grid gap-2 p-5 sm:grid-cols-3">
              {CONTRACT_TYPES.map((ct, i) => (
                <button key={ct.label} type="button" onClick={() => setContractIdx(i)}
                  className={`rounded-md border px-3 py-2 text-left text-[12px] transition-colors ${
                    contractIdx === i
                      ? "border-brand bg-brand/10 text-graphite-100"
                      : "border-graphite-700 bg-graphite-800 text-graphite-400 hover:border-graphite-600 hover:text-graphite-200"
                  }`}>
                  <span className="block font-medium">{ct.label}</span>
                  <span className="mt-0.5 block text-[11px] text-graphite-500">
                    {ct.units > 0 ? `~${ct.units.toLocaleString()} gas` : "Enter below"}
                  </span>
                </button>
              ))}
            </div>
            {CONTRACT_TYPES[contractIdx].units === 0 && (
              <div className="border-t border-graphite-700 p-5">
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-graphite-400">Custom gas units</span>
                  <Input type="number" min="21000" value={customUnits} onChange={e => setCustomUnits(e.target.value)} className="max-w-[200px]" />
                </label>
              </div>
            )}
          </Panel>

          {/* Gas speed */}
          <Panel>
            <div className="panel-header">
              <div>
                <p className="text-[14px] font-semibold text-graphite-100">Gas Speed / Gwei</p>
                <p className="mt-0.5 text-[12px] text-graphite-500">Pick a speed tier or enter a manual gwei override.</p>
              </div>
              <Zap size={18} className="text-graphite-500" />
            </div>
            <div className="grid gap-2 px-5 pb-3 sm:grid-cols-4">
              {SPEED_TIERS.map(t => {
                const tP   = Math.max(t.priBase[network], liveP * 1.1);
                const tMax = baseGwei * t.baseMul + tP;
                return (
                  <button key={t.key} type="button"
                    onClick={() => { setSpeedKey(t.key); setManualGwei(""); }}
                    className={`rounded-md border p-3 text-left transition-colors ${
                      speedKey === t.key && !manualGwei
                        ? "border-brand bg-brand/10"
                        : "border-graphite-700 bg-graphite-800 hover:border-graphite-600"
                    }`}>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold text-graphite-100">{t.label}</span>
                      <Badge tone={t.badge}>{t.key}</Badge>
                    </div>
                    <p className="mt-1.5 font-mono text-[13px] font-bold text-graphite-100">
                      {hasGas ? fg(tMax) : "—"} gwei
                    </p>
                    <p className="text-[11px] text-graphite-500">{t.baseMul}× base fee</p>
                  </button>
                );
              })}
            </div>
            <div className="border-t border-graphite-700 p-5">
              <label>
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-graphite-500">
                  Manual gwei override <span className="normal-case text-graphite-600">(leave blank to use speed tier)</span>
                </span>
                <div className="flex items-center gap-3">
                  <Input type="number" min="0" step="any" value={manualGwei}
                    onChange={e => setManualGwei(e.target.value)}
                    placeholder={hasGas ? `Auto: ${fg(effective)} gwei` : "e.g. 5.0"}
                    className="max-w-[240px]" />
                  {willLand !== null && (
                    <span className={`rounded-md border px-3 py-2 text-[12px] font-semibold ${
                      willLand
                        ? "border-status-green-border bg-status-green-bg text-status-green-text"
                        : "border-status-red-border bg-status-red-bg text-status-red-text"
                    }`}>
                      {willLand ? "✓ Will land" : `✗ Need ${fg(recMax)} gwei`}
                    </span>
                  )}
                </div>
              </label>
            </div>
          </Panel>

          {/* ── Wallet balance checker ──────────────────────────────────── */}
          <Panel>
            <div className="panel-header">
              <div>
                <p className="text-[14px] font-semibold text-graphite-100">Wallet Balance Checker</p>
                <p className="mt-0.5 text-[12px] text-graphite-500">
                  Enter your wallet&apos;s ETH balance — see the max gwei you can afford and which speed tiers are reachable.
                </p>
              </div>
              <Wallet size={18} className="text-graphite-500" />
            </div>
            <div className="p-5 space-y-4">
              {/* Mode toggle */}
              <div className="flex items-center gap-1 rounded-md border border-graphite-700 bg-graphite-900 p-1 w-fit">
                <button
                  type="button"
                  onClick={() => setBalanceMode("full")}
                  className={`rounded px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                    balanceMode === "full"
                      ? "bg-brand text-white"
                      : "text-graphite-400 hover:text-graphite-200"
                  }`}>
                  Full Balance
                </button>
                <button
                  type="button"
                  onClick={() => setBalanceMode("gas")}
                  className={`rounded px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                    balanceMode === "gas"
                      ? "bg-brand text-white"
                      : "text-graphite-400 hover:text-graphite-200"
                  }`}>
                  Gas Budget Only
                </button>
              </div>
              <p className="text-[11px] text-graphite-500">
                {balanceMode === "full"
                  ? "Wallet total ETH — mint fee auto subtracted to get gas budget."
                  : "ETH set aside for gas only — mint fee not included."}
              </p>

              <label>
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-graphite-500">
                  {balanceMode === "full" ? "Wallet balance (ETH)" : "Gas budget (ETH)"}
                </span>
                <Input
                  type="number" min="0" step="any"
                  value={walletBalance}
                  onChange={e => setWalletBalance(e.target.value)}
                  placeholder={balanceMode === "full" ? "e.g. 0.08" : "e.g. 0.01"}
                  className="max-w-[240px]"
                />
              </label>

              {balanceEntered && (
                <div className="space-y-3">

                  {/* Balance summary row */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-md border border-graphite-700 bg-graphite-800 p-4">
                      <p className="text-[10px] uppercase tracking-[0.08em] text-graphite-500">Balance</p>
                      <p className="mt-2 font-mono text-[22px] font-bold leading-none text-graphite-100">{f6(balanceEth)}</p>
                      <p className="mt-0.5 text-[11px] font-semibold text-graphite-400">ETH</p>
                      {ethUsd > 0 && <p className="mt-1.5 text-[12px] text-graphite-500">${f2(balanceEth * ethUsd)}</p>}
                    </div>
                    <div className="rounded-md border border-graphite-700 bg-graphite-800 p-4">
                      <p className="text-[10px] uppercase tracking-[0.08em] text-graphite-500">
                        {balanceMode === "full" ? "After Mint Fee" : "Gas Budget"}
                      </p>
                      <p className={`mt-2 font-mono text-[22px] font-bold leading-none ${remainingForGas > 0 ? "text-status-green-text" : "text-status-red-text"}`}>
                        {f6(remainingForGas)}
                      </p>
                      <p className={`mt-0.5 text-[11px] font-semibold ${remainingForGas > 0 ? "text-status-green-text" : "text-status-red-text"}`} style={{ opacity: 0.7 }}>
                        ETH
                      </p>
                      <p className="mt-1.5 text-[12px] text-graphite-500">
                        {balanceMode === "full" ? "left for gas" : "available"}
                      </p>
                    </div>
                    <div className="rounded-md border border-graphite-700 bg-graphite-800 p-4">
                      <p className="text-[10px] uppercase tracking-[0.08em] text-graphite-500">Max Gwei</p>
                      <p className={`mt-2 font-mono text-[22px] font-bold leading-none ${maxAffordableGwei > 0 ? "text-brand" : "text-status-red-text"}`}>
                        {maxAffordableGwei > 0 ? fg(maxAffordableGwei) : "0"}
                      </p>
                      <p className={`mt-0.5 text-[11px] font-semibold ${maxAffordableGwei > 0 ? "text-brand" : "text-status-red-text"}`} style={{ opacity: 0.7 }}>
                        gwei
                      </p>
                      <p className="mt-1.5 text-[12px] text-graphite-500">you can set</p>
                    </div>
                  </div>

                  {/* Can't afford mint fee */}
                  {canAffordMint === false && (
                    <div className="rounded-md border border-status-red-border bg-status-red-bg px-3 py-2.5 text-[12px] text-status-red-text">
                      ✗ Insufficient balance — mint fee alone is {f6(mintEthPer)} ETH
                      {shortfall !== null && ` (short by ${f6(shortfall)} ETH / $${f2(shortfall * ethUsd)})`}
                    </div>
                  )}

                  {/* Best affordable tier highlight */}
                  {hasGas && canAffordMint === true && (
                    <div className={`rounded-md border px-3 py-2.5 text-[12px] font-semibold ${
                      bestAffordableTier
                        ? "border-status-green-border bg-status-green-bg text-status-green-text"
                        : "border-status-red-border bg-status-red-bg text-status-red-text"
                    }`}>
                      {bestAffordableTier
                        ? `✓ Fastest affordable tier: ${bestAffordableTier.label} (${fg(bestAffordableTier.tMax)} gwei)`
                        : `✗ Balance too low for any speed tier — need at least ${f6(tierAffordability[0].tCost)} ETH`}
                    </div>
                  )}

                  {/* Tier affordability table */}
                  {hasGas && (
                    <div className="overflow-hidden rounded-md border border-graphite-700">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="border-b border-graphite-700 bg-graphite-800/60 text-left text-graphite-500">
                            <th className="px-3 py-2">Speed</th>
                            <th className="px-3 py-2">Needs gwei</th>
                            <th className="px-3 py-2">Total cost</th>
                            <th className="px-3 py-2">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tierAffordability.map(t => (
                            <tr key={t.key} className={`border-b border-graphite-700/50 ${t.canAfford ? "bg-graphite-800/20" : "opacity-50"}`}>
                              <td className="px-3 py-2.5"><Badge tone={t.badge}>{t.label}</Badge></td>
                              <td className="px-3 py-2.5 font-mono text-graphite-200">{fg(t.tMax)} gwei</td>
                              <td className="px-3 py-2.5">
                                <p className="font-mono text-graphite-200">{f6(t.tCost)} ETH</p>
                                {ethUsd > 0 && <p className="font-mono text-[11px] text-graphite-500">${f2(t.tCost * ethUsd)}</p>}
                              </td>
                              <td className="px-3 py-2.5">
                                {t.canAfford === true ? (
                                  <span className="font-semibold text-status-green-text">✓ Can afford</span>
                                ) : t.canAfford === false ? (
                                  <span className="text-status-red-text">✗ Short {f6(t.tCost - balanceEth)} ETH</span>
                                ) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Max gwei vs live base fee comparison */}
                  {hasGas && maxAffordableGwei > 0 && (
                    <div className="rounded-md border border-graphite-700 bg-graphite-800/40 px-3 py-2.5 text-[12px] text-graphite-400 space-y-1">
                      <p>
                        <span className="text-graphite-300 font-medium">Max affordable:</span>{" "}
                        <span className="font-mono text-graphite-100">{fg(maxAffordableGwei)} gwei</span>
                        {maxAffordableGwei >= (baseGwei * SPEED_TIERS[2].baseMul + Math.max(SPEED_TIERS[2].priBase[network], liveP * 1.1))
                          ? <span className="ml-2 text-status-green-text">✓ Fast mint reachable</span>
                          : maxAffordableGwei >= (baseGwei * SPEED_TIERS[1].baseMul + Math.max(SPEED_TIERS[1].priBase[network], liveP * 1.1))
                          ? <span className="ml-2 text-yellow-400">~ Balanced speed only</span>
                          : <span className="ml-2 text-status-red-text">✗ Below Fast tier threshold</span>
                        }
                      </p>
                      <p>
                        <span className="text-graphite-300 font-medium">Live base fee:</span>{" "}
                        <span className="font-mono text-graphite-100">{fg(baseGwei)} gwei</span>
                        <span className="ml-2">— your max is{" "}
                          <span className={maxAffordableGwei > baseGwei ? "text-status-green-text" : "text-status-red-text"}>
                            {maxAffordableGwei > baseGwei
                              ? `${fg(maxAffordableGwei / baseGwei)}× base fee`
                              : "below base fee"}
                          </span>
                        </span>
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Panel>

          {/* Speed comparison table */}
          <Panel>
            <div className="panel-header">
              <p className="text-[14px] font-semibold text-graphite-100">Speed Comparison</p>
              <button type="button" onClick={() => refetch()}
                className="flex items-center gap-1 text-[11px] text-graphite-500 hover:text-graphite-300">
                <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
                {lastUpdate}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-graphite-700 text-left text-graphite-500">
                    <th className="px-4 py-2">Speed</th>
                    <th className="px-4 py-2">Gwei</th>
                    <th className="px-4 py-2">Gas/wallet</th>
                    <th className="px-4 py-2">Gas USDT</th>
                    <th className="px-4 py-2">Mint+Gas/wallet</th>
                    <th className="px-4 py-2">Total ({wallets}w)</th>
                  </tr>
                </thead>
                <tbody>
                  {SPEED_TIERS.map(t => {
                    const tP      = Math.max(t.priBase[network], liveP * 1.1);
                    const tMax    = baseGwei * t.baseMul + tP;
                    const tEff    = Math.min(tMax, baseGwei + tP);
                    const tGas    = gas2eth(gasUnits, tEff);
                    const tTot    = tGas + mintEthPer;
                    const tTotAll = tTot * wallets;
                    const active  = t.key === speedKey && !manualGwei;
                    return (
                      <tr key={t.key}
                        className={`border-b border-graphite-700/50 cursor-pointer transition-colors ${active ? "bg-brand/5" : "hover:bg-graphite-800/40"}`}
                        onClick={() => { setSpeedKey(t.key); setManualGwei(""); }}>
                        <td className="px-4 py-2.5"><Badge tone={t.badge}>{t.label}</Badge></td>
                        <td className="px-4 py-2.5 font-mono text-graphite-100">{hasGas ? fg(tMax) : "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-graphite-200">{hasGas ? f6(tGas) : "—"} ETH</td>
                        <td className="px-4 py-2.5 font-mono text-graphite-200">${hasGas && ethUsd ? f2(eth2usd(tGas, ethUsd)) : "—"}</td>
                        <td className="px-4 py-2.5 font-mono text-graphite-100">{hasGas ? f6(tTot) : "—"} ETH</td>
                        <td className="px-4 py-2.5 font-mono font-semibold text-graphite-100">${hasGas && ethUsd ? f2(eth2usd(tTotAll, ethUsd)) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        {/* ══════════════════ RIGHT ══════════════════ */}
        <div className="space-y-4">

          {/* Active gwei */}
          <div className="rounded-md border border-graphite-700 bg-graphite-800/60 px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.08em] text-graphite-500">Active Gwei Setting</p>
              <p className="mt-0.5 text-[22px] font-bold text-graphite-100 font-mono">
                {hasGas || manualG > 0 ? fg(useGwei) : "—"}
                <span className="ml-1 text-[13px] font-normal text-graphite-500">gwei</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-graphite-500">
                {manualG > 0 ? "Manual override" : `${tier.label} tier • auto`}
              </p>
              <p className="mt-0.5 text-[12px] text-graphite-400">{gasUnits.toLocaleString()} gas units</p>
            </div>
          </div>

          {/* Balance result card — shown when balance entered */}
          {balanceEntered && hasGas && (
            <div className={`rounded-md border p-4 space-y-2 ${
              bestAffordableTier
                ? "border-status-green-border bg-status-green-bg/10"
                : "border-status-red-border bg-status-red-bg/10"
            }`}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-graphite-400">Balance Analysis</p>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-graphite-400">Your balance</span>
                <span className="font-mono text-[13px] text-graphite-100">{f6(balanceEth)} ETH</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-graphite-400">Max gwei you can set</span>
                <span className={`font-mono text-[15px] font-bold ${maxAffordableGwei > 0 ? "text-graphite-100" : "text-status-red-text"}`}>
                  {maxAffordableGwei > 0 ? fg(maxAffordableGwei) : "0"} gwei
                </span>
              </div>
              <div className="border-t border-graphite-700/50 pt-2">
                <p className={`text-[13px] font-semibold ${bestAffordableTier ? "text-status-green-text" : "text-status-red-text"}`}>
                  {bestAffordableTier
                    ? `✓ Can mint at ${bestAffordableTier.label} speed`
                    : "✗ Cannot afford any speed tier"}
                </p>
                {bestAffordableTier && (
                  <p className="mt-0.5 text-[11px] text-graphite-500">
                    Need {fg(bestAffordableTier.tMax)} gwei — you can afford up to {fg(maxAffordableGwei)} gwei
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Per wallet */}
          <Panel>
            <div className="panel-header">
              <p className="text-[14px] font-semibold text-graphite-100">Per Wallet</p>
              <span className="text-[12px] text-graphite-500">{qty > 1 ? `${qty}× mint` : "1 mint"}</span>
            </div>
            <div className="space-y-2 p-4">
              <Row label="Gas fee"
                eth={hasGas || manualG > 0 ? f6(gasEthPer) : "—"}
                usd={hasGas || manualG > 0 ? f2(gasUsdPer) : "—"} />
              <Row label={`Mint fee${qty > 1 ? ` (${qty}×)` : ""}`}
                eth={f6(mintEthPer)} usd={ethUsd ? f2(mintUsdPer) : "—"} />
              <div className="my-1 border-t border-graphite-700" />
              <Row label="Total per wallet"
                eth={hasGas || manualG > 0 ? f6(totalEthPer) : "—"}
                usd={hasGas || manualG > 0 ? f2(totalUsdPer) : "—"}
                highlight />
              <Row label="Max cap per wallet"
                eth={hasGas || manualG > 0 ? f6(totalCapPer) : "—"}
                usd={hasGas || manualG > 0 ? f2(eth2usd(totalCapPer, ethUsd)) : "—"} />
            </div>
          </Panel>

          {/* All wallets */}
          <Panel>
            <div className="panel-header">
              <p className="text-[14px] font-semibold text-graphite-100">All Wallets</p>
              <span className="text-[12px] text-graphite-500">{wallets}w × {qty} mint{qty > 1 ? "s" : ""}</span>
            </div>
            <div className="space-y-2 p-4">
              <Row label="Total gas"
                eth={hasGas || manualG > 0 ? f6(gasEthAll) : "—"}
                usd={hasGas || manualG > 0 ? f2(gasUsdAll) : "—"} />
              <Row label="Total mint fee"
                eth={f6(mintEthAll)} usd={ethUsd ? f2(mintUsdAll) : "—"} />
              <div className="my-1 border-t border-graphite-700" />
              <Row label={`Grand total (${wallets}w)`}
                eth={hasGas || manualG > 0 ? f4(totalEthAll) : "—"}
                usd={hasGas || manualG > 0 ? f2(totalUsdAll) : "—"}
                highlight />
              <Row label="Max cap total"
                eth={hasGas || manualG > 0 ? f4(totalCapAll) : "—"}
                usd={hasGas || manualG > 0 ? f2(totalCapUsd) : "—"} />
            </div>
          </Panel>

          {/* Cost summary */}
          <div className="rounded-md border border-brand/30 bg-brand/5 p-4 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-brand">Cost Summary</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] text-graphite-500">Gas cost (USDT)</p>
                <p className="text-[18px] font-bold text-graphite-100">${hasGas || manualG > 0 ? f2(gasUsdAll) : "—"}</p>
              </div>
              <div>
                <p className="text-[11px] text-graphite-500">Mint cost (USDT)</p>
                <p className="text-[18px] font-bold text-graphite-100">${ethUsd ? f2(mintUsdAll) : "—"}</p>
              </div>
              <div className="col-span-2 border-t border-graphite-700 pt-3">
                <p className="text-[11px] text-graphite-500">Total spend (USDT)</p>
                <p className="text-[26px] font-black text-graphite-100">
                  ${hasGas || manualG > 0 ? f2(totalUsdAll) : "—"}
                </p>
                <p className="text-[11px] text-graphite-500 mt-0.5">
                  {hasGas || manualG > 0
                    ? `${f4(totalEthAll)} ETH across ${wallets} wallet${wallets > 1 ? "s" : ""}`
                    : "Enter details above"}
                </p>
              </div>
            </div>
          </div>

          {/* Gwei reference */}
          {hasGas && (
            <div className="rounded-md border border-graphite-700 bg-graphite-800/60 p-4 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-graphite-400">Gwei Reference</p>
              {SPEED_TIERS.map(t => {
                const tP = Math.max(t.priBase[network], liveP * 1.1);
                const tM = baseGwei * t.baseMul + tP;
                const affordable = balanceEntered ? maxAffordableGwei >= tM : null;
                return (
                  <div key={t.key} className="flex items-center justify-between">
                    <Badge tone={t.badge}>{t.label}</Badge>
                    <span className="font-mono text-[12px] text-graphite-100">{fg(tM)} gwei</span>
                    {affordable !== null && (
                      <span className={`text-[11px] font-semibold ${affordable ? "text-status-green-text" : "text-status-red-text"}`}>
                        {affordable ? "✓" : "✗"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
