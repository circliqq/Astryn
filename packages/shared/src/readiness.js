const weights = {
    walletFunded: 20,
    eligible: 20,
    simulationPassed: 20,
    gasUnderCap: 15,
    rpcHealthy: 10,
    nonceClean: 10,
    contractLowRisk: 5
};
const blockerLabels = {
    walletFunded: "Wallet does not have enough ETH for mint plus gas.",
    eligible: "Wallet is not eligible for the selected mint phase.",
    simulationPassed: "Simulation failed, so the transaction will not be sent.",
    gasUnderCap: "Current gas exceeds the configured gas cap."
};
const warningLabels = {
    rpcHealthy: "RPC pool is degraded.",
    nonceClean: "Wallet nonce appears stuck or out of sequence.",
    contractLowRisk: "Contract risk checks found warnings."
};
export function readinessLevel(score) {
    if (score >= 90)
        return "Excellent";
    if (score >= 75)
        return "Good";
    if (score >= 50)
        return "Risky";
    return "Do not mint";
}
export function calculateReadinessScore(inputs) {
    const breakdown = Object.fromEntries(Object.entries(weights).map(([key, weight]) => [
        key,
        inputs[key] ? weight : 0
    ]));
    const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
    const blockers = Object.entries(blockerLabels)
        .filter(([key]) => !inputs[key])
        .map(([, label]) => label);
    const warnings = Object.entries(warningLabels)
        .filter(([key]) => !inputs[key])
        .map(([, label]) => label);
    return {
        score,
        level: readinessLevel(score),
        breakdown,
        blockers,
        warnings
    };
}
//# sourceMappingURL=readiness.js.map