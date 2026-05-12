import { describe, expect, it } from "vitest";
import { calculateReadinessScore } from "../src/readiness.js";

describe("calculateReadinessScore", () => {
  it("calculates a perfect score", () => {
    expect(
      calculateReadinessScore({
        walletFunded: true,
        eligible: true,
        simulationPassed: true,
        gasUnderCap: true,
        rpcHealthy: true,
        nonceClean: true,
        contractLowRisk: true
      }).score
    ).toBe(100);
  });

  it("marks missing core requirements as blockers", () => {
    const result = calculateReadinessScore({
      walletFunded: false,
      eligible: false,
      simulationPassed: true,
      gasUnderCap: true,
      rpcHealthy: true,
      nonceClean: true,
      contractLowRisk: true
    });

    expect(result.score).toBe(60);
    expect(result.level).toBe("Risky");
    expect(result.blockers).toHaveLength(2);
  });
});
