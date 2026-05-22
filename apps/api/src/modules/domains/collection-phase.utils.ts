import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MintPhaseType, type Prisma } from "@prisma/client";
import { OpenSeaClient } from "@mint-copilot/opensea";
import { fetchSeaDropPublicStartTime, SEA_DROP_ADDRESS } from "@mint-copilot/blockchain";
import { PrismaService } from "../prisma/prisma.service.js";

export type PhaseWindowStatus = "LIVE" | "UPCOMING" | "ENDED";

export interface ResolvedPhaseWindow {
  phaseType: MintPhaseType;
  startTime: Date;
  endTime: Date | null;
  phaseStatus: PhaseWindowStatus;
}

export interface CollectionPhaseRefreshResult {
  collection: CollectionWithPhases;
  phaseSource: "live" | "stored";
  phaseWarning: string | null;
  phaseCheckedAt: string;
}

export const collectionInclude = {
  phases: {
    orderBy: { startTime: "asc" as const }
  }
} satisfies Prisma.CollectionInclude;

export type CollectionWithPhases = Prisma.CollectionGetPayload<{ include: typeof collectionInclude }>;

export async function getCollectionWithPhaseData(
  prisma: PrismaService,
  config: ConfigService,
  collectionId: string,
  options?: { requireLive?: boolean }
): Promise<CollectionPhaseRefreshResult> {
  const storedCollection = await prisma.collection.findUniqueOrThrow({
    where: { id: collectionId },
    include: collectionInclude
  });
  const client = new OpenSeaClient({ apiKey: config.getOrThrow<string>("OPENSEA_API_KEY") });

  try {
    const livePhases = await client.getDropPhases(storedCollection.slug);
    if (livePhases.length === 0) {
      return resolveStoredPhaseFallback(
        storedCollection,
        options?.requireLive,
        "OpenSea did not return any phase timing for this collection."
      );
    }

    // Fetch on-chain SeaDrop startTime for PUBLIC phases to override inaccurate
    // OpenSea API times. The contract's startTime is the authoritative value.
    let onChainPublicStartTime: Date | null = null;
    const hasPublicPhase = livePhases.some((p) => phaseTypeToPrisma(p.type) === "PUBLIC");
    if (hasPublicPhase && storedCollection.contractAddress) {
      try {
        const chain = (storedCollection as { chain?: string }).chain;
        const chainName = chain === "BASE" ? "base" : "ethereum";
        const rpcKey = chainName === "base" ? "BASE_RPC_PRIMARY" : "ETH_RPC_PRIMARY";
        const rpcUrl = config.get<string>(rpcKey);
        if (rpcUrl) {
          onChainPublicStartTime = await fetchSeaDropPublicStartTime(
            { chainName, rpcUrl },
            SEA_DROP_ADDRESS,
            storedCollection.contractAddress,
          );
        }
      } catch { /* non-fatal — fall back to OpenSea API time */ }
    }

    const refreshedCollection = await prisma.collection.update({
      where: { id: storedCollection.id },
      data: {
        mintPriceWei: livePhases[0]?.priceEth ? ethToWei(livePhases[0].priceEth) : storedCollection.mintPriceWei,
        phases: {
          deleteMany: {},
          create: livePhases.map((phase) => {
            const phaseType = phaseTypeToPrisma(phase.type);
            const apiStartTime = new Date(phase.startTime);
            // Use on-chain time for PUBLIC phases if available and differs by >1s.
            const startTime =
              phaseType === "PUBLIC" && onChainPublicStartTime &&
              Math.abs(onChainPublicStartTime.getTime() - apiStartTime.getTime()) > 1000
                ? onChainPublicStartTime
                : apiStartTime;
            return {
              phaseType,
              priceWei: ethToWei(phase.priceEth),
              startTime,
              endTime: phase.endTime ? new Date(phase.endTime) : undefined,
              maxMint: phase.maxMintPerWallet ?? null,
            };
          })
        }
      },
      include: collectionInclude
    });

    return {
      collection: refreshedCollection,
      phaseSource: "live",
      phaseWarning: null,
      phaseCheckedAt: new Date().toISOString()
    };
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    const message = error instanceof Error ? error.message : "Live phase refresh failed.";
    return resolveStoredPhaseFallback(storedCollection, options?.requireLive, message);
  }
}

export function resolvePhaseWindows(
  phases: Array<{ phaseType: MintPhaseType; startTime: Date; endTime: Date | null }>
): ResolvedPhaseWindow[] {
  const uniquePhaseTypes = [...new Set(phases.map((phase) => phase.phaseType))];
  return uniquePhaseTypes
    .map((phaseType) => resolvePhaseWindow(phases, phaseType))
    .filter((window): window is ResolvedPhaseWindow => window !== null);
}

export function resolvePhaseWindow(
  phases: Array<{ phaseType: MintPhaseType; startTime: Date; endTime: Date | null }>,
  phaseType: MintPhaseType
): ResolvedPhaseWindow | null {
  const now = Date.now();
  const matching = phases
    .filter((phase) => phase.phaseType === phaseType)
    .sort((left, right) => left.startTime.getTime() - right.startTime.getTime());

  if (matching.length === 0) return null;

  const live = matching.find((phase) => {
    const start = phase.startTime.getTime();
    const end = phase.endTime?.getTime();
    return start <= now && (end == null || end >= now);
  });
  if (live) {
    return { phaseType, startTime: live.startTime, endTime: live.endTime, phaseStatus: "LIVE" };
  }

  const upcoming = matching.find((phase) => phase.startTime.getTime() > now);
  if (upcoming) {
    return { phaseType, startTime: upcoming.startTime, endTime: upcoming.endTime, phaseStatus: "UPCOMING" };
  }

  const ended = matching[matching.length - 1];
  return { phaseType, startTime: ended.startTime, endTime: ended.endTime, phaseStatus: "ENDED" };
}

export function resolveScheduleAtFromPhase(
  phases: Array<{ phaseType: MintPhaseType; startTime: Date; endTime: Date | null }>,
  phaseType: MintPhaseType
) {
  let matchingWindow = resolvePhaseWindow(phases, phaseType);

  // GTD / FCFS are OpenSea allowlist variants — live phase refresh may store them as ALLOWLIST.
  // Fall back to ALLOWLIST if the specific type isn't found.
  if (!matchingWindow && (phaseType === "GTD" || phaseType === "FCFS")) {
    matchingWindow = resolvePhaseWindow(phases, "ALLOWLIST");
  }

  // If still no match (e.g. live refresh normalised all phases differently), fall back to
  // any non-PUBLIC upcoming/live phase, then any upcoming/live phase.
  if (!matchingWindow) {
    const allWindows = resolvePhaseWindows(phases);
    const active = allWindows.filter((w) => w.phaseStatus !== "ENDED");
    matchingWindow =
      active.find((w) => w.phaseType !== "PUBLIC") ??
      active.find((w) => w.phaseType === "PUBLIC") ??
      null;
  }

  if (!matchingWindow) {
    throw new BadRequestException("No matching phase found for this collection.");
  }

  if (matchingWindow.phaseStatus === "LIVE") return new Date();
  if (matchingWindow.phaseStatus === "UPCOMING") return matchingWindow.startTime;
  throw new BadRequestException("The selected phase has already ended.");
}

export function phaseTypeToPrisma(phaseType: string): MintPhaseType {
  const normalized = phaseType.toLowerCase();
  if (normalized.includes("allow")) return "ALLOWLIST";
  if (normalized.includes("gtd")) return "GTD";
  if (normalized.includes("fcfs")) return "FCFS";
  return "PUBLIC";
}

export function toOpenSeaPhase(phaseType: MintPhaseType): "public" | "allowlist" | "gtd" | "fcfs" {
  const normalized = phaseType.toLowerCase();
  // GTD and FCFS are OpenSea allowlist variants — the eligibility API only accepts "allowlist".
  // Sending "gtd" / "fcfs" returns 404 which gets misread as "eligible" for everyone.
  if (normalized === "gtd" || normalized === "fcfs" || normalized === "allowlist") return "allowlist";
  return "public";
}

export function ethToWei(eth: string): string {
  try {
    const value = parseFloat(eth);
    if (Number.isNaN(value)) return "0";
    return BigInt(Math.round(value * 1e18)).toString();
  } catch {
    return "0";
  }
}

function resolveStoredPhaseFallback(
  collection: CollectionWithPhases,
  requireLive = false,
  message: string
): CollectionPhaseRefreshResult {
  const phaseWarning = `${message} Using the last scanned phase timing instead.`;

  if (requireLive) {
    throw new BadRequestException(
      `${message} Live phase timing is required before scheduling. Try again in a moment or rescan the collection.`
    );
  }

  return {
    collection,
    phaseSource: "stored",
    phaseWarning,
    phaseCheckedAt: new Date().toISOString()
  };
}
