import { parseGwei } from "viem";
import { describe, expect, it } from "vitest";
import {
  buildBumpedFees,
  estimateTotalGasCost,
  estimateTransactionGasCost,
  presetGasSettings,
  resolveGasFees
} from "../src/index.ts";

describe("gas engine", () => {
  it("detects gas cap breaches", () => {
    const settings = presetGasSettings("safe");
    const estimate = estimateTotalGasCost(1_000_000n, parseGwei("100"), settings);
    expect(estimate.underCap).toBe(false);
  });

  it("bumps pending tx fees under caps", () => {
    const settings = presetGasSettings("balanced");
    const bumped = buildBumpedFees({
      currentMaxFeePerGas: parseGwei("10"),
      currentPriorityFeePerGas: parseGwei("1"),
      attempt: 1,
      settings
    });
    expect(bumped.maxFeePerGas).toBeGreaterThan(parseGwei("10"));
  });

  it("checks caps against live effective fees instead of the user max fee ceiling", () => {
    const settings = presetGasSettings("balanced");
    const fees = resolveGasFees(
      {
        baseFeePerGas: parseGwei("2"),
        maxPriorityFeePerGas: parseGwei("1"),
        maxFeePerGas: parseGwei("5")
      },
      settings
    );
    const estimate = estimateTransactionGasCost(350_000n, fees, settings);

    expect(fees.maxFeePerGas).toBe(parseGwei("6"));
    expect(fees.effectiveFeePerGas).toBe(parseGwei("4"));
    expect(estimate.underCap).toBe(true);
  });

  it("keeps max fee high enough to carry the configured priority fee", () => {
    const settings = presetGasSettings("aggressive");
    const fees = resolveGasFees(
      {
        baseFeePerGas: parseGwei("1"),
        maxPriorityFeePerGas: parseGwei("1"),
        maxFeePerGas: parseGwei("3")
      },
      settings
    );

    expect(fees.maxPriorityFeePerGas).toBe(parseGwei("15"));
    expect(fees.maxFeePerGas).toBe(parseGwei("17"));
    expect(fees.effectiveFeePerGas).toBe(parseGwei("16"));
  });

  it("detects when the user max fee cannot cover the current base fee", () => {
    const settings = presetGasSettings("safe");
    const fees = resolveGasFees(
      {
        baseFeePerGas: parseGwei("40"),
        maxPriorityFeePerGas: parseGwei("2"),
        maxFeePerGas: parseGwei("82")
      },
      settings
    );

    expect(fees.maxFeePerGas).toBe(parseGwei("35"));
    expect(fees.baseFeeCovered).toBe(false);
  });
});
