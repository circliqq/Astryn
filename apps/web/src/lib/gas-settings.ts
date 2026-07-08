export type GasMode = "safe" | "balanced" | "aggressive";
export type NetworkKey = "base" | "ethereum" | "robinhood";

export interface GasSettings {
  mode: GasMode;
  maxFeeGwei: number;
  priorityFeeGwei: number;
  maxTotalGasCostEth: number;
  gasBumpEnabled: boolean;
  maxBumpAttempts: number;
}

export interface GasQuote {
  baseFeePerGas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
}

export interface GasRecommendation {
  mode: GasMode;
  settings: GasSettings;
  liveBaseGwei: number;
  livePriorityGwei: number;
  effectiveGwei: number;
  estimatedGasUnits: number;
  estimatedGasCostEth: number;
  maxGasCostEth: number;
  totalGasCostEth: number;
  walletCount: number;
  label: string;
  detail: string;
}

export const GAS_SETTINGS_STORAGE_KEY = "mc_gas_settings";
export const WALLET_GAS_STORAGE_KEY = "mc_wallet_gas";
export const DEFAULT_MINT_GAS_UNITS = 350_000;

/**
 * Fallback presets used ONLY when live gas data is unavailable.
 * These are conservative but realistic — they do NOT act as cost floors
 * when live data is present (buildGasRecommendation ignores these when gas is live).
 */
export const GAS_PRESETS: Record<GasMode, GasSettings> = {
  safe: {
    mode: "safe",
    maxFeeGwei: 3,
    priorityFeeGwei: 0.05,
    maxTotalGasCostEth: 0.001,
    gasBumpEnabled: true,
    maxBumpAttempts: 2
  },
  balanced: {
    mode: "balanced",
    maxFeeGwei: 8,
    priorityFeeGwei: 0.1,
    maxTotalGasCostEth: 0.002,
    gasBumpEnabled: true,
    maxBumpAttempts: 3
  },
  aggressive: {
    mode: "aggressive",
    maxFeeGwei: 25,
    priorityFeeGwei: 0.5,
    maxTotalGasCostEth: 0.005,
    gasBumpEnabled: true,
    maxBumpAttempts: 5
  }
};

/**
 * How much to scale above live gas per mode.
 *
 * maxFeeBaseMultiplier — how many × baseFee to set as buffer room
 *   Safe:       1.15×  (covers ~2 block base-fee increases)
 *   Balanced:   1.5×   (covers ~5 block spike)
 *   Aggressive: 2.0×   (covers hard spike, still wins in competition)
 *
 * priorityMultiplier — scales live priorityFee; the absolute floor below
 *   prevents setting 0-priority when mempool is empty.
 *
 * capMultiplier — maxCap = maxFeeGwei × gasUnits × capMultiplier.
 *   Purely computed from live gas — no hardcoded ETH floor anymore.
 */
const MODE_FACTORS: Record<
  GasMode,
  {
    maxFeeBaseMultiplier: number;
    priorityMultiplier: number;
    capMultiplier: number;
    label: string;
    bumpAttempts: number;
  }
> = {
  safe: {
    maxFeeBaseMultiplier: 1.15,
    priorityMultiplier: 1.1,
    capMultiplier: 1.1,
    label: "Safe",
    bumpAttempts: 2
  },
  balanced: {
    maxFeeBaseMultiplier: 1.5,
    priorityMultiplier: 1.3,
    capMultiplier: 1.15,
    label: "Balanced",
    bumpAttempts: 3
  },
  aggressive: {
    maxFeeBaseMultiplier: 2.0,
    priorityMultiplier: 1.5,
    capMultiplier: 1.2,
    label: "Aggressive",
    bumpAttempts: 5
  }
};

/**
 * Absolute minimum priority fee — only kicks in when live priority is
 * near zero (empty mempool). Kept very small so it never dominates maxFee.
 * Old values (1–4 gwei on ETH) were the main cause of over-gassing.
 */
const MIN_PRIORITY_BY_NETWORK: Record<NetworkKey, Record<GasMode, number>> = {
  base: {
    safe:       0.0005,
    balanced:   0.001,
    aggressive: 0.002
  },
  ethereum: {
    safe:       0.01,
    balanced:   0.05,
    aggressive: 0.1
  },
  robinhood: {
    safe:       0.0001,
    balanced:   0.0005,
    aggressive: 0.001
  }
};

export function loadSavedGasSettings(): GasSettings {
  if (typeof window === "undefined") return GAS_PRESETS.balanced;

  try {
    const raw = window.localStorage.getItem(GAS_SETTINGS_STORAGE_KEY);
    if (!raw) return GAS_PRESETS.balanced;
    return normalizeGasSettings(JSON.parse(raw), "balanced");
  } catch {
    return GAS_PRESETS.balanced;
  }
}

export function saveGasSettings(settings: GasSettings) {
  window.localStorage.setItem(GAS_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeGasSettings(settings, settings.mode)));
}

export function loadWalletGasSettings(): Record<string, GasSettings> {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(WALLET_GAS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([walletId, settings]) => [walletId, normalizeGasSettings(settings, "balanced")] as const)
        .filter(([, settings]) => isUsableGasSettings(settings))
    );
  } catch {
    return {};
  }
}

export function saveWalletGasSettings(overrides: Record<string, GasSettings>) {
  window.localStorage.setItem(WALLET_GAS_STORAGE_KEY, JSON.stringify(overrides));
}

export function gweiFromWei(wei: string | null | undefined) {
  if (!wei) return null;
  try {
    return Number(BigInt(wei)) / 1e9;
  } catch {
    return null;
  }
}

export function ethForGas(gasUnits: number, gwei: number) {
  return (gasUnits * gwei) / 1e9;
}

export function buildGasRecommendation(input: {
  gas: GasQuote;
  network: NetworkKey;
  mode: GasMode;
  estimatedGasUnits: number;
  walletCount: number;
}): GasRecommendation | null {
  const liveBaseGwei = gweiFromWei(input.gas.baseFeePerGas);
  const livePriorityGwei = gweiFromWei(input.gas.maxPriorityFeePerGas);
  const liveMaxGwei = gweiFromWei(input.gas.maxFeePerGas);
  if (liveBaseGwei == null || livePriorityGwei == null) return null;

  const gasUnits = sanitizeGasUnits(input.estimatedGasUnits);
  const walletCount = Math.max(1, Math.floor(input.walletCount ?? 1));
  const factors = MODE_FACTORS[input.mode];

  // Priority: scale live priority, but never go below the tiny absolute floor.
  // We do NOT use liveMaxGwei as a floor — that value is already 2×baseFee
  // from the node and would inflate maxFee before our multipliers even apply.
  const minPriorityGwei = MIN_PRIORITY_BY_NETWORK[input.network][input.mode];
  const priorityFeeGwei = roundGwei(Math.max(livePriorityGwei * factors.priorityMultiplier, minPriorityGwei));

  // maxFee: baseFee × buffer + priority. Pure live-data calculation.
  const maxFeeGwei = roundGwei(liveBaseGwei * factors.maxFeeBaseMultiplier + priorityFeeGwei);

  // Effective gwei = what we actually expect to pay (base + priority, capped at maxFee).
  const effectiveGwei = Math.min(maxFeeGwei, liveBaseGwei + priorityFeeGwei);
  const estimatedGasCostEth = ethForGas(gasUnits, effectiveGwei);

  // Max cap: purely computed from live maxFee × safety buffer.
  // Old code had Math.max(..., GAS_PRESETS[mode].maxTotalGasCostEth) which locked
  // in a hardcoded ETH floor (e.g. 0.003 ETH) even when real cost was 10× lower.
  const maxGasCostEth = roundEth(ethForGas(gasUnits, maxFeeGwei) * factors.capMultiplier);

  return {
    mode: input.mode,
    settings: {
      mode: input.mode,
      maxFeeGwei,
      priorityFeeGwei,
      maxTotalGasCostEth: maxGasCostEth,
      gasBumpEnabled: true,
      maxBumpAttempts: factors.bumpAttempts
    },
    liveBaseGwei,
    livePriorityGwei,
    effectiveGwei,
    estimatedGasUnits: gasUnits,
    estimatedGasCostEth,
    maxGasCostEth,
    totalGasCostEth: estimatedGasCostEth * walletCount,
    walletCount,
    label: factors.label,
    detail: `Live base ${liveBaseGwei.toFixed(4)} gwei → max fee ${maxFeeGwei} gwei (${factors.maxFeeBaseMultiplier}× buffer). Est. cost ${estimatedGasCostEth.toFixed(6)} ETH, cap ${maxGasCostEth.toFixed(6)} ETH per wallet.`
  };
}

/**
 * Network-relative thresholds for auto-recommending a gas mode.
 * Old thresholds (15 / 45 gwei) were ETH-mainnet-historic and made everything
 * "safe" on Base (where base fees are <0.01 gwei) and at today's low ETH gas.
 */
const RECOMMEND_THRESHOLDS: Record<NetworkKey, { balanced: number; aggressive: number }> = {
  base:      { balanced: 0.01,  aggressive: 0.05  },
  ethereum:  { balanced: 5,     aggressive: 20    },
  robinhood: { balanced: 0.01,  aggressive: 0.05  },
};

export function recommendGasMode(input: {
  gas: GasQuote | undefined;
  network: NetworkKey;
  estimatedGasUnits?: number;
  walletCount: number;
}) {
  if (!input.gas) return null;
  const baseGwei = gweiFromWei(input.gas.baseFeePerGas);
  if (baseGwei == null) return null;

  const { balanced, aggressive } = RECOMMEND_THRESHOLDS[input.network];
  const mode: GasMode =
    baseGwei >= aggressive ? "aggressive" :
    baseGwei >= balanced   ? "balanced"   : "safe";

  return buildGasRecommendation({
    gas: input.gas,
    network: input.network,
    mode,
    estimatedGasUnits: input.estimatedGasUnits ?? DEFAULT_MINT_GAS_UNITS,
    walletCount: input.walletCount
  });
}

export function normalizeGasSettings(value: unknown, fallbackMode: GasMode): GasSettings {
  const fallback = GAS_PRESETS[fallbackMode];
  if (value == null || typeof value !== "object") return fallback;
  const raw = value as Partial<GasSettings>;
  const mode = isGasMode(raw.mode) ? raw.mode : fallbackMode;
  const preset = GAS_PRESETS[mode];

  return {
    mode,
    maxFeeGwei: positiveNumber(raw.maxFeeGwei, preset.maxFeeGwei),
    priorityFeeGwei: positiveNumber(raw.priorityFeeGwei, preset.priorityFeeGwei),
    maxTotalGasCostEth: positiveNumber(raw.maxTotalGasCostEth, preset.maxTotalGasCostEth),
    gasBumpEnabled: typeof raw.gasBumpEnabled === "boolean" ? raw.gasBumpEnabled : preset.gasBumpEnabled,
    maxBumpAttempts: Math.max(1, Math.floor(positiveNumber(raw.maxBumpAttempts, preset.maxBumpAttempts)))
  };
}

export function isSameGasSettings(left: GasSettings, right: GasSettings) {
  return (
    left.mode === right.mode &&
    left.maxFeeGwei === right.maxFeeGwei &&
    left.priorityFeeGwei === right.priorityFeeGwei &&
    left.maxTotalGasCostEth === right.maxTotalGasCostEth &&
    left.gasBumpEnabled === right.gasBumpEnabled &&
    left.maxBumpAttempts === right.maxBumpAttempts
  );
}

function sanitizeGasUnits(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return DEFAULT_MINT_GAS_UNITS;
  return Math.max(21_000, Math.floor(value));
}

function positiveNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function isGasMode(value: unknown): value is GasMode {
  return value === "safe" || value === "balanced" || value === "aggressive";
}

function isUsableGasSettings(settings: GasSettings) {
  return settings.maxFeeGwei > 0 && settings.priorityFeeGwei > 0 && settings.maxTotalGasCostEth > 0;
}

function roundGwei(value: number) {
  if (value < 1) return Math.ceil(value * 10_000) / 10_000;
  if (value < 20) return Math.ceil(value * 100) / 100;
  return Math.ceil(value);
}

function roundEth(value: number) {
  if (value < 0.001) return Number(value.toFixed(6));
  if (value < 0.01) return Number(value.toFixed(5));
  return Number(value.toFixed(4));
}
