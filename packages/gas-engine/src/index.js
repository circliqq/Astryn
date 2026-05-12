import { createMintPublicClient } from "../../blockchain/src/index.ts";
import { formatEther, parseGwei } from "viem";
export function presetGasSettings(mode) {
    const presets = {
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
            maxFeeGwei: 80,
            priorityFeeGwei: 4,
            maxTotalGasCostEth: 0.008,
            gasGuardianEnabled: true,
            gasBumpEnabled: true,
            maxBumpAttempts: 5
        }
    };
    return presets[mode];
}
export async function fetchCurrentGas(options) {
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
export function resolveGasFees(current, settings) {
    const userMaxFeePerGas = parseGwei(String(settings.maxFeeGwei));
    const userPriorityFeePerGas = parseGwei(String(settings.priorityFeeGwei));
    const estimatedPriorityFeePerGas = current.maxPriorityFeePerGas > 0n
        ? current.maxPriorityFeePerGas
        : userPriorityFeePerGas;
    const maxPriorityFeePerGas = minBigint(estimatedPriorityFeePerGas, userPriorityFeePerGas, userMaxFeePerGas);
    const estimatedMaxFeePerGas = current.maxFeePerGas > 0n
        ? current.maxFeePerGas
        : current.baseFeePerGas * 2n + maxPriorityFeePerGas;
    const cappedMaxFeePerGas = minBigint(estimatedMaxFeePerGas, userMaxFeePerGas);
    const maxFeePerGas = cappedMaxFeePerGas < maxPriorityFeePerGas
        ? maxPriorityFeePerGas
        : cappedMaxFeePerGas;
    const effectiveFeePerGas = minBigint(maxFeePerGas, current.baseFeePerGas + maxPriorityFeePerGas);
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
export function estimateTotalGasCost(gasUnits, maxFeePerGas, settings) {
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
export function estimateTransactionGasCost(gasUnits, fees, settings) {
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
export function applyGasGuardian(estimate, settings) {
    if (settings.gasGuardianEnabled && !estimate.underCap) {
        throw new Error("Current gas exceeds your configured gas cap.");
    }
}
export function buildBumpedFees(input) {
    if (!input.settings.gasBumpEnabled)
        throw new Error("Gas bump is disabled.");
    if (input.attempt > input.settings.maxBumpAttempts) {
        throw new Error("Maximum gas bump attempts reached.");
    }
    const multiplierBps = 1125n + BigInt(input.attempt) * 125n;
    const bumpedMaxFee = (input.currentMaxFeePerGas * multiplierBps) / 1000n;
    const bumpedPriorityFee = (input.currentPriorityFeePerGas * multiplierBps) / 1000n;
    const maxFeeCap = parseGwei(String(input.settings.maxFeeGwei));
    const priorityCap = parseGwei(String(input.settings.priorityFeeGwei * 3));
    return {
        maxFeePerGas: bumpedMaxFee > maxFeeCap ? maxFeeCap : bumpedMaxFee,
        maxPriorityFeePerGas: bumpedPriorityFee > priorityCap ? priorityCap : bumpedPriorityFee
    };
}
function minBigint(first, ...rest) {
    return rest.reduce((min, value) => (value < min ? value : min), first);
}
//# sourceMappingURL=index.js.map
