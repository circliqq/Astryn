import { z } from "zod";
import { mintPhaseTypes, supportedNetworks } from "./types.js";
export const networkSchema = z.enum(supportedNetworks);
export const openSeaDropUrlSchema = z
    .string()
    .url()
    .refine((value) => new URL(value).hostname.endsWith("opensea.io"), "Must be an OpenSea URL");
export const walletImportSchema = z.object({
    name: z.string().min(1).max(80),
    privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    network: networkSchema
});
export const gasSettingsSchema = z.object({
    mode: z.enum(["safe", "balanced", "aggressive"]),
    maxFeeGwei: z.number().positive(),
    priorityFeeGwei: z.number().nonnegative(),
    maxTotalGasCostEth: z.number().positive(),
    gasGuardianEnabled: z.boolean(),
    gasBumpEnabled: z.boolean(),
    maxBumpAttempts: z.number().int().min(0).max(10)
});
export const collectionScanSchema = z.object({
    url: openSeaDropUrlSchema
});
export const mintTaskCreateSchema = z.object({
    collectionId: z.string().uuid(),
    walletIds: z.array(z.string().uuid()).min(1),
    phaseType: z.enum(mintPhaseTypes),
    scheduleAt: z.string().datetime().optional(),
    gasSettings: gasSettingsSchema
});
//# sourceMappingURL=schemas.js.map