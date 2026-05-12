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

export function presetGasSettings(mode: GasMode): GasSettings {
  const presets: Record<GasMode, GasSettings> = {
    safe: {
      mode,
      maxFeeGwei: 35,
      priorityFeeGwei: 1,
      maxTotalGasCostEth: 0.003,
      gasGuardianEnabled: true,
      gasBumpEnabled: true,
      maxBumpAttempts: 2
    },
    balanced: {
      mode,
      maxFeeGwei: 50,
      priorityFeeGwei: 2,
      maxTotalGasCostEth: 0.005,
      gasGuardianEnabled: true,
      gasBumpEnabled: true,
      maxBumpAttempts: 3
    },
    aggressive: {
      mode,
      maxFeeGwei: 200,
      priorityFeeGwei: 15,
      maxTotalGasCostEth: 0.02,
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
  const priorityFee = await client.estimateMaxPriorityFeePerGas().catch(() => parseGwei("1"));
  return {
    baseFeePerGas,
    maxPriorityFeePerGas: priorityFee,
    maxFeePerGas: baseFeePerGas * 2n + priorityFee
  };
}

export function resolveGasFees(current: GasFeeQuote, settings: GasSettings): ResolvedGasFees {
  const userMaxFeePerGas = parseGwei(String(settings.maxFeeGwei));
  const userPriorityFeePerGas = parseGwei(String(settings.priorityFeeGwei));
  const estimatedPriorityFeePerGas =
    current.maxPriorityFeePerGas > 0n
      ? current.maxPriorityFeePerGas
      : userPriorityFeePerGas;
  // Use the higher of estimated vs user priority fee so we stay competitive
  // during hot mints without being capped to a floor that may be below market.
  const rawPriorityFee =
    estimatedPriorityFeePerGas > userPriorityFeePerGas
      ? estimatedPriorityFeePerGas
      : userPriorityFeePerGas;
  const maxPriorityFeePerGas = minBigint(rawPriorityFee, userMaxFeePerGas);
  const competitiveMaxFeePerGas = current.baseFeePerGas * 2n + maxPriorityFeePerGas;
  const estimatedMaxFeePerGas =
    current.maxFeePerGas > competitiveMaxFeePerGas
      ? current.maxFeePerGas
      : competitiveMaxFeePerGas;
  const cappedMaxFeePerGas = minBigint(estimatedMaxFeePerGas, userMaxFeePerGas);
  const maxFeePerGas =
    cappedMaxFeePerGas < maxPriorityFeePerGas
      ? maxPriorityFeePerGas
      : cappedMaxFeePerGas;
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
    userPriorityFeePerGas,
    baseFeeCovered: maxFeePerGas >= current.baseFeePerGas,
    maxFeeCapped: estimatedMaxFeePerGas > userMaxFeePerGas,
    priorityFeeCapped: estimatedPriorityFeePerGas > userPriorityFeePerGas
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
  const capWei = BigInt(Math.floor(settings.maxTotalGasCostEth * 1e18));
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
