export type GasMode = "safe" | "balanced" | "aggressive";
export type NetworkKey = "base" | "ethereum";

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

export const GAS_PRESETS: Record<GasMode, GasSettings> = {
  safe: {
    mode: "safe",
    maxFeeGwei: 35,
    priorityFeeGwei: 1,
    maxTotalGasCostEth: 0.003,
    gasBumpEnabled: true,
    maxBumpAttempts: 2
  },
  balanced: {
    mode: "balanced",
    maxFeeGwei: 50,
    priorityFeeGwei: 2,
    maxTotalGasCostEth: 0.005,
    gasBumpEnabled: true,
    maxBumpAttempts: 3
  },
  aggressive: {
    mode: "aggressive",
    maxFeeGwei: 200,
    priorityFeeGwei: 15,
    maxTotalGasCostEth: 0.02,
    gasBumpEnabled: true,
    maxBumpAttempts: 5
  }
};

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
    maxFeeBaseMultiplier: 1.3,
    priorityMultiplier: 1.05,
    capMultiplier: 1.15,
    label: "Safe",
    bumpAttempts: 2
  },
  balanced: {
    maxFeeBaseMultiplier: 2,
    priorityMultiplier: 1.45,
    capMultiplier: 1.35,
    label: "Balanced",
    bumpAttempts: 3
  },
  aggressive: {
    maxFeeBaseMultiplier: 3,
    priorityMultiplier: 2.25,
    capMultiplier: 1.7,
    label: "Aggressive",
    bumpAttempts: 5
  }
};

const MIN_PRIORITY_BY_NETWORK: Record<NetworkKey, Record<GasMode, number>> = {
  base: {
    safe: 0.003,
    balanced: 0.006,
    aggressive: 0.01
  },
  ethereum: {
    safe: 1,
    balanced: 2,
    aggressive: 4
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
  const minPriorityGwei = MIN_PRIORITY_BY_NETWORK[input.network][input.mode];
  const priorityFeeGwei = roundGwei(Math.max(livePriorityGwei * factors.priorityMultiplier, minPriorityGwei));
  const maxFeeCandidate = liveBaseGwei * factors.maxFeeBaseMultiplier + priorityFeeGwei;
  const maxFeeGwei = roundGwei(Math.max(maxFeeCandidate, liveMaxGwei ?? 0, liveBaseGwei + priorityFeeGwei));
  const effectiveGwei = Math.min(maxFeeGwei, liveBaseGwei + priorityFeeGwei);
  const estimatedGasCostEth = ethForGas(gasUnits, effectiveGwei);
  const maxGasCostEth = roundEth(Math.max(ethForGas(gasUnits, maxFeeGwei) * factors.capMultiplier, GAS_PRESETS[input.mode].maxTotalGasCostEth));

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
    detail: `${factors.label} sets max fee near ${maxFeeGwei} gwei and caps gas around ${maxGasCostEth} ETH per wallet.`
  };
}

export function recommendGasMode(input: {
  gas: GasQuote | undefined;
  network: NetworkKey;
  estimatedGasUnits?: number;
  walletCount: number;
}) {
  if (!input.gas) return null;
  const baseGwei = gweiFromWei(input.gas.baseFeePerGas);
  if (baseGwei == null) return null;

  const mode: GasMode = baseGwei < 15 ? "safe" : baseGwei < 45 ? "balanced" : "aggressive";
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
