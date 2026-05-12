import { describe, expect, it } from "vitest";
import { buildGasRecommendation, recommendGasMode } from "./gas-settings";

function weiFromGwei(gwei: number) {
  return BigInt(Math.round(gwei * 1e9)).toString();
}

describe("gas settings recommendation", () => {
  it("uses a practical Ethereum priority fee floor when live priority is tiny", () => {
    const recommendation = recommendGasMode({
      network: "ethereum",
      walletCount: 2,
      gas: {
        baseFeePerGas: weiFromGwei(4),
        maxPriorityFeePerGas: weiFromGwei(0.004),
        maxFeePerGas: weiFromGwei(8.004)
      }
    });

    expect(recommendation).not.toBeNull();
    if (!recommendation) throw new Error("Expected a gas recommendation.");
    expect(recommendation.mode).toBe("safe");
    expect(recommendation.settings.priorityFeeGwei).toBe(1);
    expect(recommendation.settings.maxFeeGwei).toBeGreaterThanOrEqual(8.004);
    expect(recommendation.settings.maxTotalGasCostEth).toBeGreaterThan(0);
  });

  it("keeps aggressive max fee above the current base fee during high gas", () => {
    const recommendation = buildGasRecommendation({
      network: "ethereum",
      mode: "aggressive",
      estimatedGasUnits: 350_000,
      walletCount: 1,
      gas: {
        baseFeePerGas: weiFromGwei(80),
        maxPriorityFeePerGas: weiFromGwei(2),
        maxFeePerGas: weiFromGwei(162)
      }
    });

    expect(recommendation).not.toBeNull();
    if (!recommendation) throw new Error("Expected a gas recommendation.");
    expect(recommendation.settings.maxFeeGwei).toBeGreaterThan(80);
    expect(recommendation.settings.maxTotalGasCostEth).toBeGreaterThan(recommendation.estimatedGasCostEth ?? 0);
  });
});
