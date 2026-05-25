"use client";

import { useEffect, useState } from "react";
import { Info, Minus, Plus, X, Zap } from "lucide-react";
import { DEFAULT_MINT_GAS_UNITS } from "@/lib/gas-settings";

export type ModalCurrency = "USD" | "ETH" | "GWEI";
export type SpendingMode = "speed" | "economy";

export interface AdvancedGasModalSettings {
  currency: ModalCurrency;
  budget: string;
  spendingMode: SpendingMode;
  gasLimit: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (settings: AdvancedGasModalSettings) => void;
  initial: AdvancedGasModalSettings;
  ethUsdPrice: number | null;
  liveBaseGwei: number | null;
  phaseLabel?: string;
  /** Recommended gas limit from on-chain simulation (already includes buffer). */
  suggestedGasLimit?: number;
}

// ── helpers ──────────────────────────────────────────────────────────────────
function toEth(budget: string, currency: ModalCurrency, ethUsdPrice: number | null, gasLimit: number): number {
  const raw = Number(budget);
  if (!raw || raw <= 0) return 0;
  if (currency === "ETH") return raw;
  if (currency === "USD") return ethUsdPrice && ethUsdPrice > 0 ? raw / ethUsdPrice : 0;
  // GWEI: budget is in gwei-per-gas → total ETH = raw * gasLimit / 1e9
  return (raw * gasLimit) / 1e9;
}

function toGweiPerGas(budget: string, currency: ModalCurrency, ethUsdPrice: number | null, gasLimit: number): number {
  const eth = toEth(budget, currency, ethUsdPrice, gasLimit);
  if (!eth || !gasLimit) return 0;
  return (eth / gasLimit) * 1e9;
}

function toUsd(budget: string, currency: ModalCurrency, ethUsdPrice: number | null, gasLimit: number): number {
  if (currency === "USD") return Number(budget) || 0;
  const eth = toEth(budget, currency, ethUsdPrice, gasLimit);
  return ethUsdPrice ? eth * ethUsdPrice : 0;
}

function maxBudgetFromGwei(liveBaseGwei: number | null, gasLimit: number): number {
  if (!liveBaseGwei) return 0;
  // Aggressive: 2× base fee * gasLimit → ETH
  return (liveBaseGwei * 2 * gasLimit) / 1e9;
}

// ── component ─────────────────────────────────────────────────────────────────
export default function AdvancedGasModal({
  open,
  onClose,
  onSave,
  initial,
  ethUsdPrice,
  liveBaseGwei,
  phaseLabel = "PUBLIC STAGE",
  suggestedGasLimit,
}: Props) {
  const [currency, setCurrency] = useState<ModalCurrency>(initial.currency);
  const [budget, setBudget] = useState(initial.budget);
  const [spendingMode, setSpendingMode] = useState<SpendingMode>(initial.spendingMode);
  const [gasLimit, setGasLimit] = useState(initial.gasLimit);

  // Reset local state when modal opens
  useEffect(() => {
    if (open) {
      setCurrency(initial.currency);
      setBudget(initial.budget);
      setSpendingMode(initial.spendingMode);
      setGasLimit(initial.gasLimit);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  // ── derived conversions ────────────────────────────────────────────────────
  const budgetEth = toEth(budget, currency, ethUsdPrice, gasLimit);
  const budgetGweiPerGas = toGweiPerGas(budget, currency, ethUsdPrice, gasLimit);
  const budgetUsd = toUsd(budget, currency, ethUsdPrice, gasLimit);

  const showEthConversion = currency !== "ETH" && budgetEth > 0;
  const showGweiConversion = budgetGweiPerGas > 0;
  const showUsdConversion = currency !== "USD" && ethUsdPrice && budgetUsd > 0;

  function handleMax() {
    const maxEth = maxBudgetFromGwei(liveBaseGwei, gasLimit);
    if (!maxEth) return;
    if (currency === "ETH") {
      setBudget(maxEth.toFixed(6));
    } else if (currency === "USD") {
      setBudget(ethUsdPrice ? (maxEth * ethUsdPrice).toFixed(2) : "");
    } else {
      // GWEI: gwei-per-gas = maxEth * 1e9 / gasLimit
      const gweiPerGas = (maxEth / gasLimit) * 1e9;
      setBudget(gweiPerGas.toFixed(4));
    }
  }

  function stepGasLimit(delta: number) {
    setGasLimit((prev) => Math.max(21_000, prev + delta));
  }

  function handleSave() {
    onSave({ currency, budget, spendingMode, gasLimit });
    onClose();
  }

  const currencyLabel = currency === "USD" ? "USD" : currency === "ETH" ? "ETH" : "GWEI";

  return (
    <>
      {/* ── Backdrop ── */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* ── Modal ── */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-graphite-700 bg-graphite-900 shadow-2xl">

          {/* Header */}
          <div className="flex items-start justify-between px-5 pt-5 pb-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-graphite-500">
                Phase Gas Settings
              </p>
              <p className="mt-0.5 text-[18px] font-bold text-graphite-100">
                {phaseLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-0.5 grid size-7 place-items-center rounded-full text-graphite-400 hover:bg-graphite-700 hover:text-graphite-100 transition-colors"
            >
              <X size={15} />
            </button>
          </div>

          <div className="px-5 pb-5 space-y-5">
            {/* ── Currency tabs ── */}
            <div className="flex rounded-lg border border-graphite-700 overflow-hidden text-[12px] font-semibold">
              {(["USD", "ETH", "GWEI"] as ModalCurrency[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCurrency(c)}
                  className={`flex-1 py-2 transition-colors ${
                    currency === c
                      ? "bg-brand text-white"
                      : "bg-graphite-800 text-graphite-400 hover:text-graphite-200"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>

            {/* ── Gas Budget ── */}
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-graphite-500">
                Gas Budget
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-graphite-600 bg-graphite-800 px-3 py-2.5">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="0"
                  className="min-w-0 flex-1 bg-transparent text-right text-[22px] font-bold text-graphite-100 outline-none placeholder:text-graphite-600"
                />
                <span className="shrink-0 text-[13px] font-semibold text-graphite-400">
                  {currencyLabel}
                </span>
                <button
                  type="button"
                  onClick={handleMax}
                  className="shrink-0 rounded-md bg-graphite-700 px-2.5 py-1 text-[11px] font-bold text-graphite-200 hover:bg-graphite-600 hover:text-white transition-colors"
                >
                  MAX
                </button>
              </div>

              {/* Conversion line */}
              {(showEthConversion || showGweiConversion) && (
                <p className="mt-1.5 text-[11px] text-graphite-500 tabular-nums">
                  {showEthConversion && (
                    <span className="font-mono">
                      {budgetEth.toFixed(7)} ETH
                    </span>
                  )}
                  {showEthConversion && showGweiConversion && (
                    <span className="mx-2 text-graphite-700">·</span>
                  )}
                  {showGweiConversion && (
                    <span className="font-mono">
                      {budgetGweiPerGas.toFixed(7)} GWEI/gas
                    </span>
                  )}
                  {showUsdConversion && !showEthConversion && (
                    <>
                      <span className="mx-2 text-graphite-700">·</span>
                      <span className="font-mono">≈ ${budgetUsd.toFixed(2)}</span>
                    </>
                  )}
                </p>
              )}
            </div>

            {/* ── Spending Mode ── */}
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-graphite-500">
                Spending Mode
              </p>
              <div className="flex rounded-lg border border-graphite-700 overflow-hidden text-[13px] font-semibold">
                <button
                  type="button"
                  onClick={() => setSpendingMode("speed")}
                  className={`flex-1 py-2.5 transition-colors ${
                    spendingMode === "speed"
                      ? "bg-brand text-white"
                      : "bg-graphite-800 text-graphite-400 hover:text-graphite-200"
                  }`}
                >
                  Speed
                </button>
                <button
                  type="button"
                  onClick={() => setSpendingMode("economy")}
                  className={`flex-1 py-2.5 transition-colors ${
                    spendingMode === "economy"
                      ? "bg-brand text-white"
                      : "bg-graphite-800 text-graphite-400 hover:text-graphite-200"
                  }`}
                >
                  Economy
                </button>
              </div>
              <div className="mt-2 flex items-start gap-1.5 text-[11px] text-graphite-400">
                <Info size={12} className="mt-0.5 shrink-0 text-graphite-500" />
                {spendingMode === "speed" ? (
                  <span>
                    Max fee bid set to your <strong className="text-graphite-200">full budget</strong> — ensures fastest inclusion even during fee spikes. You only pay what the network actually charges.
                  </span>
                ) : (
                  <span>
                    Max fee bid is <strong className="text-graphite-200">minimized</strong> to reduce cost. Budget acts as a hard cap — transaction may be slower if fees spike.
                  </span>
                )}
              </div>
            </div>

            {/* ── Gas Limit ── */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-graphite-500">
                  Gas Limit
                </p>
                {suggestedGasLimit && suggestedGasLimit !== gasLimit && (
                  <button
                    type="button"
                    onClick={() => setGasLimit(suggestedGasLimit)}
                    className="flex items-center gap-1 rounded-md bg-brand/15 px-2 py-0.5 text-[10px] font-semibold text-brand hover:bg-brand/25 transition-colors"
                  >
                    <Zap size={9} />
                    Use estimate: {suggestedGasLimit.toLocaleString()}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => stepGasLimit(-10_000)}
                  className="grid size-9 shrink-0 place-items-center rounded-lg border border-graphite-600 bg-graphite-800 text-graphite-300 hover:border-graphite-500 hover:text-white transition-colors"
                >
                  <Minus size={14} />
                </button>
                <div className="flex flex-1 items-center gap-2 rounded-lg border border-graphite-600 bg-graphite-800 px-3 py-2.5">
                  <input
                    type="number"
                    min="21000"
                    step="1000"
                    value={gasLimit}
                    onChange={(e) =>
                      setGasLimit(Math.max(21_000, Number(e.target.value) || DEFAULT_MINT_GAS_UNITS))
                    }
                    className="min-w-0 flex-1 bg-transparent text-center text-[15px] font-bold text-graphite-100 outline-none tabular-nums"
                  />
                  <span className="shrink-0 text-[11px] font-semibold text-graphite-500">GAS</span>
                </div>
                <button
                  type="button"
                  onClick={() => stepGasLimit(10_000)}
                  className="grid size-9 shrink-0 place-items-center rounded-lg border border-graphite-600 bg-graphite-800 text-graphite-300 hover:border-graphite-500 hover:text-white transition-colors"
                >
                  <Plus size={14} />
                </button>
              </div>

              {/* Live estimate hint */}
              {budgetGweiPerGas > 0 && liveBaseGwei !== null && (
                <p className="mt-1.5 text-[11px] text-graphite-500 tabular-nums">
                  <Zap size={10} className="inline -mt-px text-brand mr-0.5" />
                  {spendingMode === "speed"
                    ? `Max fee: ${budgetGweiPerGas.toFixed(4)} gwei · ${(budgetGweiPerGas / Math.max(liveBaseGwei, 0.001)).toFixed(1)}× live base`
                    : `Cap: ${budgetGweiPerGas.toFixed(4)} gwei/gas · live base ${liveBaseGwei.toFixed(4)} gwei`}
                </p>
              )}
            </div>

            {/* ── Actions ── */}
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border border-graphite-600 bg-transparent py-3 text-[13px] font-semibold text-graphite-300 hover:border-graphite-500 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand py-3 text-[13px] font-semibold text-white hover:bg-brand/90 transition-colors"
              >
                Save
                <span className="text-[16px] leading-none">→</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
