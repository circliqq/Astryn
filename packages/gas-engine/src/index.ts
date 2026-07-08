import { createMintPublicClient, type BlockchainClientOptions } from "@mint-copilot/blockchain";
import { formatEther, parseGwei } from "viem";

export type GasMode = "safe" | "balanced" | "aggressive";

export interface GasSettings {
  mode: GasMode;
  maxFeeGwei: number;
  priorityFeeGwei: number;
  maxTotalGasCostEth: number;
  gasGuardianEnabled: boolean;
  gasBumpEnabled: boolean;
  maxBumpAttempts: number;
}

export interface GasEstimate {
  baseFeePerGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  estimatedGasUnits: bigint;
  totalCostWei: bigint;
  totalCostEth: string;
  underCap: boolean;
}

export interface GasFeeQuote {
  baseFeePerGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface ResolvedGasFees extends GasFeeQuote {
  effectiveFeePerGas: bigint;
  userMaxFeePerGas: bigint;
  userPriorityFeePerGas: bigint;
  baseFeeCovered: boolean;
  maxFeeCapped: boolean;
  priorityFeeCapped: boolean;
}

// ── Mode multipliers (must match apps/web/src/lib/gas-settings.ts) ────────────
const MODE_FACTORS: Record<GasMode, { base: number; priority: number; cap: number }> = {
  safe:       { base: 1.15, priority: 1.1,  cap: 1.1  },
  balanced:   { base: 1.5,  priority: 1.3,  cap: 1.15 },
  aggressive: { base: 2.0,  priority: 1.5,  cap: 1.2  },
};

// Absolute minimum priority fee per network per mode (in gwei).
// Kept very small — only kicks in when mempool is empty (live priority ≈ 0).
const MIN_PRIORITY_GWEI: Record<"ethereum" | "base" | "robinhood", Record<GasMode, number>> = {
  ethereum: { safe: 0.01, balanced: 0.05, aggressive: 0.1  },
  base:     { safe: 0.0005, balanced: 0.001, aggressive: 0.002 },
  // Robinhood Chain (Arbitrum Orbit L2): priority fee is effectively unused
  // (first-come-first-served sequencer ordering) — keep floors near zero.
  robinhood: { safe: 0.0001, balanced: 0.0005, aggressive: 0.001 },
};

/**
 * Fallback presets — used ONLY when no live gas data is available.
 * These do NOT act as cost floors at execution time.
 */
export function presetGasSettings(mode: GasMode): GasSettings {
  const presets: Record<GasMode, GasSettings> = {
    safe: {
      mode,
      maxFeeGwei: 3,
      priorityFeeGwei: 0.05,
      maxTotalGasCostEth: 0.001,
      gasGuardianEnabled: true,
      gasBumpEnabled: true,
      maxBumpAttempts: 2
    },
    balanced: {
      mode,
      maxFeeGwei: 8,
      priorityFeeGwei: 0.1,
      maxTotalGasCostEth: 0.002,
      gasGuardianEnabled: true,
      gasBumpEnabled: true,
      maxBumpAttempts: 3
    },
    aggressive: {
      mode,
      maxFeeGwei: 25,
      priorityFeeGwei: 0.5,
      maxTotalGasCostEth: 0.005,
      gasGuardianEnabled: true,
      gasBumpEnabled: true,
      maxBumpAttempts: 5
    }
  };
  return presets[mode];
}

export async function fetchCurrentGas(options: BlockchainClientOptions) {
  const client = createMintPublicClient(options);
  const block = await client.getBlock();
  const baseFeePerGas = block.baseFeePerGas ?? 0n;
  // Fallback was parseGwei("1") — that 1 gwei floor was inflating all calculations
  // when the mempool is empty. Changed to 0.01 gwei (still safely above zero).
  const priorityFee = await client.estimateMaxPriorityFeePerGas().catch(() => parseGwei("0.01"));
  return {
    baseFeePerGas,
    maxPriorityFeePerGas: priorityFee,
    // Note: this value is informational only — resolveGasFees does NOT use it as a floor.
    maxFeePerGas: baseFeePerGas * 2n + priorityFee
  };
}

/**
 * Resolve the actual gas fees to submit at mint time.
 *
 * Key change from old implementation:
 * - We now recalculate maxFeePerGas using the MODE multiplier against live baseFee.
 *   This means gas always tracks the chain at the moment of minting, not the stale
 *   value saved at task-setup time.
 * - The saved `settings.maxFeeGwei` acts as a hard upper ceiling only (prevents
 *   runaway gas in bot-warfare spikes).
 * - Old code used `current.maxFeePerGas` (node's 2×baseFee estimate) as a floor,
 *   which inflated fees before the user cap even applied.
 */
export function resolveGasFees(
  current: GasFeeQuote,
  settings: GasSettings,
  network: "ethereum" | "base" | "robinhood" = "ethereum"
): ResolvedGasFees {
  const factors = MODE_FACTORS[settings.mode];
  const minPriority = MIN_PRIORITY_GWEI[network][settings.mode];

  // ── 1. Priority fee ────────────────────────────────────────────────────
  // Scale live priority by the mode multiplier; use tiny absolute floor if
  // mempool is empty (live priority ≈ 0). Old floor was 1–4 gwei, causing
  // priority to dominate maxFee at low-gas conditions.
  const livePriorityGwei = Number(current.maxPriorityFeePerGas) / 1e9;
  const computedPriorityGwei = Math.max(livePriorityGwei * factors.priority, minPriority);
  const userPriorityGwei = settings.priorityFeeGwei;
  // Use whichever is higher: mode-computed or user's saved setting
  const rawPriorityGwei = Math.max(computedPriorityGwei, userPriorityGwei);
  const maxPriorityFeePerGas = parseGwei(String(rawPriorityGwei.toFixed(9)));

  // ── 2. Max fee — recalculated live, not from stale saved value ─────────
  // baseFee × mode_multiplier + priority  (pure live-gas formula)
  const liveBaseGwei = Number(current.baseFeePerGas) / 1e9;
  const liveMaxFeeGwei = liveBaseGwei * factors.base + rawPriorityGwei;

  // Saved maxFeeGwei = hard ceiling to prevent overpaying during spikes.
  const userMaxFeePerGas = parseGwei(String(settings.maxFeeGwei));
  const liveMaxFeePerGas = parseGwei(String(liveMaxFeeGwei.toFixed(9)));

  // Use live-computed value, capped at user's ceiling
  const cappedMaxFeePerGas = liveMaxFeePerGas < userMaxFeePerGas
    ? liveMaxFeePerGas
    : userMaxFeePerGas;

  const maxFeePerGas = cappedMaxFeePerGas < maxPriorityFeePerGas
    ? maxPriorityFeePerGas
    : cappedMaxFeePerGas;

  // ── 3. Effective fee — what we actually pay (base + priority, ≤ maxFee) ─
  const effectiveFeePerGas = minBigint(
    maxFeePerGas,
    current.baseFeePerGas + maxPriorityFeePerGas
  );

  return {
    baseFeePerGas: current.baseFeePerGas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    effectiveFeePerGas,
    userMaxFeePerGas,
    userPriorityFeePerGas: parseGwei(String(userPriorityGwei)),
    baseFeeCovered: maxFeePerGas >= current.baseFeePerGas,
    maxFeeCapped: liveMaxFeePerGas > userMaxFeePerGas,
    priorityFeeCapped: false // We never cap priority below market anymore
  };
}

export function estimateTotalGasCost(
  gasUnits: bigint,
  maxFeePerGas: bigint,
  settings: GasSettings
): GasEstimate {
  const totalCostWei = gasUnits * maxFeePerGas;
  const capWei = BigInt(Math.floor(settings.maxTotalGasCostEth * 1e18));
  return {
    baseFeePerGas: 0n,
    maxFeePerGas,
    maxPriorityFeePerGas: parseGwei(String(settings.priorityFeeGwei)),
    estimatedGasUnits: gasUnits,
    totalCostWei,
    totalCostEth: formatEther(totalCostWei),
    underCap: totalCostWei <= capWei
  };
}

export function estimateTransactionGasCost(
  gasUnits: bigint,
  fees: Pick<
    ResolvedGasFees,
    "baseFeePerGas" | "maxFeePerGas" | "maxPriorityFeePerGas" | "effectiveFeePerGas"
  >,
  settings: GasSettings
): GasEstimate {
  const totalCostWei = gasUnits * fees.effectiveFeePerGas;
  // Cap is now computed from live maxFee × mode cap multiplier, not hardcoded preset
  const factors = MODE_FACTORS[settings.mode];
  const liveCapWei = fees.maxFeePerGas * BigInt(Math.round(factors.cap * 1000)) / 1000n;
  const userCapWei = BigInt(Math.floor(settings.maxTotalGasCostEth * 1e18));
  // Use the higher of the two caps so user's explicit cap is always respected
  const capWei = liveCapWei > userCapWei ? liveCapWei : userCapWei;
  return {
    baseFeePerGas: fees.baseFeePerGas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    estimatedGasUnits: gasUnits,
    totalCostWei,
    totalCostEth: formatEther(totalCostWei),
    underCap: totalCostWei <= capWei
  };
}

export function applyGasGuardian(estimate: GasEstimate, settings: GasSettings): void {
  if (settings.gasGuardianEnabled && !estimate.underCap) {
    throw new Error("Current gas exceeds your configured gas cap.");
  }
}

export function buildBumpedFees(input: {
  currentMaxFeePerGas: bigint;
  currentPriorityFeePerGas: bigint;
  attempt: number;
  settings: GasSettings;
}) {
  if (!input.settings.gasBumpEnabled) throw new Error("Gas bump is disabled.");
  if (input.attempt > input.settings.maxBumpAttempts) {
    throw new Error("Maximum gas bump attempts reached.");
  }

  const multiplierBps = 1_125n + BigInt(input.attempt) * 125n;
  const bumpedMaxFee = (input.currentMaxFeePerGas * multiplierBps) / 1_000n;
  const bumpedPriorityFee = (input.currentPriorityFeePerGas * multiplierBps) / 1_000n;
  const maxFeeCap = parseGwei(String(input.settings.maxFeeGwei));
  const priorityCap = parseGwei(String(input.settings.priorityFeeGwei * 3));

  return {
    maxFeePerGas: bumpedMaxFee > maxFeeCap ? maxFeeCap : bumpedMaxFee,
    maxPriorityFeePerGas: bumpedPriorityFee > priorityCap ? priorityCap : bumpedPriorityFee
  };
}

function minBigint(first: bigint, ...rest: bigint[]) {
  return rest.reduce((min, value) => (value < min ? value : min), first);
}
