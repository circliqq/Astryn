import {
  Controller,
  Get,
  Module,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { type Prisma } from "@prisma/client";
import { AuthGuard } from "../auth/auth.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller("scanner-feed")
@UseGuards(AuthGuard)
class DropScannerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Live feed of discovered drops, newest / soonest first. */
  @Get()
  list(
    @Query("chain") chain?: string,
    @Query("status") status?: string,
    @Query("maxRisk") maxRisk?: string,
    @Query("q") q?: string,
  ) {
    const where: Prisma.ScannedDropWhereInput = {};
    if (chain === "ETHEREUM" || chain === "BASE") where.chain = chain;
    if (status === "upcoming" || status === "live" || status === "ended") where.status = status;
    const maxRiskNum = maxRisk ? Number(maxRisk) : NaN;
    if (Number.isFinite(maxRiskNum)) where.riskScore = { lte: maxRiskNum };
    if (q && q.trim()) {
      where.OR = [
        { name: { contains: q.trim(), mode: "insensitive" } },
        { slug: { contains: q.trim(), mode: "insensitive" } },
        { contractAddress: { contains: q.trim(), mode: "insensitive" } },
      ];
    }

    return this.prisma.scannedDrop.findMany({
      where,
      orderBy: [{ status: "asc" }, { publicStartTime: "asc" }, { lastSeenAt: "desc" }],
      take: 200,
    });
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.prisma.scannedDrop.findUniqueOrThrow({ where: { id } });
  }

  /** Trigger an immediate scan (in addition to the worker's timer). */
  @Post("scan-now")
  async scanNow() {
    const queue = new Queue("scanner-queue", {
      connection: { url: this.config.getOrThrow<string>("REDIS_URL") },
    });
    try {
      await queue.add("scan", {}, { jobId: `scan-${Date.now()}`, attempts: 1, removeOnComplete: true });
    } catch {
      throw new ServiceUnavailableException("Scanner queue unavailable. Start Redis and the worker.");
    } finally {
      await queue.close().catch(() => undefined);
    }
    return { ok: true };
  }
}

@Module({ controllers: [DropScannerController] })
export class DropScannerModule {}
