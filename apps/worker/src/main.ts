import os from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { QueueEvents, Worker } from "bullmq";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { logger } from "@mint-copilot/logger";
import { executeMintTask, executeInstantFlipJob } from "./processors/mint-task.processor.js";
import { processRpcHealth } from "./processors/rpc-health.processor.js";
import { processReport } from "./processors/report.processor.js";
import { processFunding } from "./processors/funding.processor.js";
import { processSniperWatch } from "./processors/sniper.processor.js";
import { processNotification } from "./processors/notifications.processor.js";

const WORKER_HEARTBEAT_KEY = "mint-copilot:scheduler:worker-heartbeat";
const WORKER_HEARTBEAT_INTERVAL_MS = 10_000;
const WORKER_HEARTBEAT_TTL_SECONDS = 30;

loadRootEnv();

const connection = new Redis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  },
);
const prisma = new PrismaClient();
const workerId = `${os.hostname()}-${process.pid}`;

const workers = [
  new Worker(
    "mint-task-queue",
    (job) => {
      if (job.name === "instant-flip") return executeInstantFlipJob(job, prisma);
      return executeMintTask(job, prisma);
    },
    { connection, concurrency: 3 },
  ),
  new Worker("rpc-health-queue", (job) => processRpcHealth(job, prisma), {
    connection,
    concurrency: 5,
  }),
  new Worker("report-queue", (job) => processReport(job, prisma), {
    connection,
    concurrency: 2,
  }),
  new Worker("funding-queue", (job) => processFunding(job, prisma), {
    connection,
    concurrency: 2,
  }),
  new Worker("sniper-queue", (job) => processSniperWatch(job, prisma), {
    connection,
    concurrency: 5,
  }),
  new Worker("notifications-queue", (job) => processNotification(job, prisma), {
    connection,
    concurrency: 3,
  }),
];

for (const queueName of [
  "mint-task-queue",
  "rpc-health-queue",
  "report-queue",
  "funding-queue",
  "sniper-queue",
  "notifications-queue",
]) {
  const events = new QueueEvents(queueName, { connection });
  events.on("failed", ({ jobId, failedReason }) =>
    logger.error({ queueName, jobId, failedReason }, "job failed"),
  );
  events.on("completed", ({ jobId }) =>
    logger.info({ queueName, jobId }, "job completed"),
  );
}

async function publishWorkerHeartbeat() {
  await connection.set(
    WORKER_HEARTBEAT_KEY,
    JSON.stringify({ workerId, lastHeartbeatAt: new Date().toISOString() }),
    "EX",
    WORKER_HEARTBEAT_TTL_SECONDS,
  );
}

void publishWorkerHeartbeat().catch((error) => {
  logger.warn({ workerId, error }, "worker heartbeat failed");
});

const heartbeatInterval = setInterval(() => {
  void publishWorkerHeartbeat().catch((error) => {
    logger.warn({ workerId, error }, "worker heartbeat failed");
  });
}, WORKER_HEARTBEAT_INTERVAL_MS);
heartbeatInterval.unref();

async function shutdown() {
  logger.info("worker shutting down");
  clearInterval(heartbeatInterval);
  await Promise.all(workers.map((worker) => worker.close()));
  await prisma.$disconnect();
  await connection.quit();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

function loadRootEnv() {
  const workerDir = dirname(fileURLToPath(import.meta.url));
  const envPath = findEnvPath([process.cwd(), workerDir]);
  if (!envPath) {
    logger.warn("worker .env file was not found");
    return;
  }

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    if (process.env[key] !== undefined) continue;

    process.env[key] = normalizeEnvValue(trimmed.slice(equalsIndex + 1).trim());
  }
}

function findEnvPath(startDirs: string[]) {
  const seen = new Set<string>();

  for (const startDir of startDirs) {
    let currentDir = resolve(startDir);

    while (!seen.has(currentDir)) {
      seen.add(currentDir);

      const envPath = resolve(currentDir, ".env");
      if (existsSync(envPath)) return envPath;

      const parentDir = dirname(currentDir);
      if (parentDir === currentDir) break;

      currentDir = parentDir;
    }
  }

  return null;
}

function normalizeEnvValue(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
