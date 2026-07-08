export const supportedNetworks = ["base", "ethereum", "robinhood"] as const;
export type SupportedNetwork = (typeof supportedNetworks)[number];

export const mintPhaseTypes = ["public", "allowlist", "gtd", "fcfs"] as const;
export type MintPhaseType = (typeof mintPhaseTypes)[number];

export const walletStatuses = [
  "ready",
  "low_balance",
  "need_funding",
  "not_eligible",
  "nonce_issue"
] as const;
export type WalletStatus = (typeof walletStatuses)[number];

export type ReadinessLevel = "Excellent" | "Good" | "Risky" | "Do not mint";

export type RpcHealthStatus = "healthy" | "degraded" | "offline";

export interface ReadinessInputs {
  walletFunded: boolean;
  eligible: boolean;
  simulationPassed: boolean;
  gasUnderCap: boolean;
  rpcHealthy: boolean;
  nonceClean: boolean;
  contractLowRisk: boolean;
}

export interface ReadinessResult {
  score: number;
  level: ReadinessLevel;
  breakdown: Record<keyof ReadinessInputs, number>;
  blockers: string[];
  warnings: string[];
}

export interface UserFacingError {
  code: string;
  message: string;
  retryable: boolean;
}
