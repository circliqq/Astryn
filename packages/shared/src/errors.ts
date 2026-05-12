import type { UserFacingError } from "./types.js";

const knownErrors: Array<[RegExp, UserFacingError]> = [
  [
    /noteligible|not allowlisted|allowlist/i,
    {
      code: "NotEligible",
      message: "Wallet is not allowlisted.",
      retryable: false,
    },
  ],
  [
    /insufficient funds|exceeds balance/i,
    {
      code: "InsufficientFunds",
      message: "Wallet does not have enough ETH for mint plus gas.",
      retryable: false,
    },
  ],
  [
    /replacement transaction underpriced/i,
    {
      code: "GasBumpTooLow",
      message: "Gas bump was too low.",
      retryable: true,
    },
  ],
  [
    /nonce too low|already known/i,
    {
      code: "NonceConflict",
      message: "Wallet nonce is no longer current.",
      retryable: true,
    },
  ],
  [
    /not started|not active|not live|sale has not started|mint has not started|phase is not active|paused/i,
    {
      code: "MintNotOpen",
      message: "Mint is not open yet, so the pre-open blockchain check could not pass.",
      retryable: true,
    },
  ],
  [
    /max fee per gas .*less than .*block base fee|fee cap .*less than .*block base fee|underpriced/i,
    {
      code: "GasTooLow",
      message: "Configured gas fee is too low for the current block.",
      retryable: true,
    },
  ],
  [
    /current gas exceeds .*configured gas cap/i,
    {
      code: "GasCapExceeded",
      message: "Current gas exceeds your configured gas cap.",
      retryable: true,
    },
  ],
  [
    /intrinsic gas too low|out of gas/i,
    {
      code: "GasLimitTooLow",
      message: "Configured gas limit was too low for this mint transaction.",
      retryable: true,
    },
  ],
  [
    /[A-Z0-9_]+ is required/i,
    {
      code: "ConfigurationMissing",
      message:
        "Worker configuration is missing a required value. Check .env and restart the worker.",
      retryable: true,
    },
  ],
];

export function toUserFacingError(error: unknown): UserFacingError {
  const raw = error instanceof Error ? error.message : String(error);
  const mapped = knownErrors.find(([pattern]) => pattern.test(raw));
  if (mapped) return mapped[1];
  const details = raw.length > 180 ? `${raw.slice(0, 177)}...` : raw;
  return {
    code: "BlockchainError",
    message: `The blockchain request failed: ${details}`,
    retryable: true,
  };
}
