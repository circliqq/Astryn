import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "ioredis";

export const SCHEDULER_WORKER_HEARTBEAT_KEY = "mint-copilot:scheduler:worker-heartbeat";
export const SCHEDULER_WORKER_HEARTBEAT_INTERVAL_MS = 10_000;
export const SCHEDULER_WORKER_HEARTBEAT_MAX_AGE_MS = 30_000;

export interface SchedulerReadiness {
  ready: boolean;
  redis: boolean;
  worker: boolean;
  lastHeartbeatAt: string | null;
  workerId: string | null;
  message: string;
}

export async function getSchedulerReadiness(config: ConfigService): Promise<SchedulerReadiness> {
  const redisUrl = config.get<string>("REDIS_URL");
  if (!redisUrl) {
    return {
      ready: false,
      redis: false,
      worker: false,
      lastHeartbeatAt: null,
      workerId: null,
      message: "Redis is not configured. Start Redis and the worker before scheduling runs."
    };
  }

  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: false
  });

  try {
    await redis.connect();
    await redis.ping();

    const rawHeartbeat = await redis.get(SCHEDULER_WORKER_HEARTBEAT_KEY);
    const parsedHeartbeat = parseHeartbeat(rawHeartbeat);
    const heartbeatAgeMs = parsedHeartbeat?.lastHeartbeatAt
      ? Date.now() - new Date(parsedHeartbeat.lastHeartbeatAt).getTime()
      : Number.POSITIVE_INFINITY;
    const workerHealthy = Number.isFinite(heartbeatAgeMs) && heartbeatAgeMs <= SCHEDULER_WORKER_HEARTBEAT_MAX_AGE_MS;

    return {
      ready: workerHealthy,
      redis: true,
      worker: workerHealthy,
      lastHeartbeatAt: parsedHeartbeat?.lastHeartbeatAt ?? null,
      workerId: parsedHeartbeat?.workerId ?? null,
      message: workerHealthy
        ? "Scheduler is ready."
        : "The worker is not connected. Start the worker before scheduling runs."
    };
  } catch {
    return {
      ready: false,
      redis: false,
      worker: false,
      lastHeartbeatAt: null,
      workerId: null,
      message: "Redis is unavailable. Start Redis and the worker before scheduling runs."
    };
  } finally {
    await redis.quit().catch(() => {
      redis.disconnect();
    });
  }
}

export async function ensureSchedulerReady(config: ConfigService) {
  const readiness = await getSchedulerReadiness(config);
  if (!readiness.ready) {
    throw new ServiceUnavailableException(readiness.message);
  }

  return readiness;
}

function parseHeartbeat(rawHeartbeat: string | null) {
  if (!rawHeartbeat) return null;

  try {
    const parsed = JSON.parse(rawHeartbeat) as { lastHeartbeatAt?: string; workerId?: string };
    return {
      lastHeartbeatAt: typeof parsed.lastHeartbeatAt === "string" ? parsed.lastHeartbeatAt : null,
      workerId: typeof parsed.workerId === "string" ? parsed.workerId : null
    };
  } catch {
    return null;
  }
}
