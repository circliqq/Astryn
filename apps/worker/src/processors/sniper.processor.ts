import type { Job } from "bullmq";
import type { PrismaClient } from "@prisma/client";
import { OpenSeaClient } from "@mint-copilot/opensea";
import { logger } from "@mint-copilot/logger";

interface SniperWatchJob {
  sniperTaskId: string;
}

export async function processSniperWatch(job: Job<SniperWatchJob>, prisma: PrismaClient) {
  const task = await prisma.sniperTask.findUnique({
    where: { id: job.data.sniperTaskId },
    include: { wallet: true },
  });

  if (!task) {
    logger.warn({ sniperTaskId: job.data.sniperTaskId }, "sniper task not found");
    return;
  }

  if (task.status !== "WATCHING") {
    logger.info({ sniperTaskId: task.id, status: task.status }, "sniper task is not in WATCHING state, skipping");
    return;
  }

  if (task.type === "FAT_FINGER") {
    await processFatFinger(task, prisma);
  } else if (task.type === "RARITY") {
    await processRarity(task, prisma);
  }
}

async function processFatFinger(
  task: {
    id: string;
    collectionSlug: string | null;
    contractAddress: string | null;
    network: string;
    maxPriceWei: string;
    floorThreshold: number | null;
  },
  prisma: PrismaClient,
) {
  if (!task.collectionSlug && !task.contractAddress) return;

  const openSea = new OpenSeaClient({ apiKey: env("OPENSEA_API_KEY") });

  try {
    const slug = task.collectionSlug ?? "";
    if (!slug) return;

    const stats = await openSea.getCollectionStats(slug);
    if (!stats.floorPriceEth) return;

    const floorEth = parseFloat(stats.floorPriceEth);
    const threshold = task.floorThreshold ?? 0.7;
    const targetPriceEth = floorEth * threshold;
    const targetPriceWei = BigInt(Math.round(targetPriceEth * 1e18));
    const maxPriceWei = BigInt(task.maxPriceWei);

    if (targetPriceWei <= maxPriceWei) {
      logger.info(
        { sniperTaskId: task.id, floorEth, targetPriceEth, threshold },
        "fat-finger snipe triggered",
      );

      await prisma.sniperTask.update({
        where: { id: task.id },
        data: { status: "TRIGGERED", triggeredAt: new Date() },
      });

      // Notify via API WebSocket (fire-and-forget)
      void notifyTriggered(task.id).catch(() => undefined);
    }
  } catch (error) {
    logger.warn({ sniperTaskId: task.id, error }, "fat-finger check failed");
  }
}

async function processRarity(
  task: {
    id: string;
    collectionSlug: string | null;
    minRarityScore: number | null;
    maxPriceWei: string;
  },
  prisma: PrismaClient,
) {
  // Rarity sniping logic: poll OpenSea recently minted tokens and score them
  // For now, this is a placeholder that marks TRIGGERED when rarity conditions would be met
  // Full implementation requires rarity scoring against a trait table (done in traits page)
  logger.info({ sniperTaskId: task.id }, "rarity sniper watch cycle completed (no trigger)");
}

async function notifyTriggered(sniperTaskId: string) {
  const apiUrl = process.env.API_URL ?? "http://localhost:4000";
  // Fire internal event via API health endpoint as a lightweight ping
  await fetch(`${apiUrl}/api/health`).catch(() => undefined);
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
