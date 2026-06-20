import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { type Prisma } from "@prisma/client";
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PlanGuard, ProOrAbove } from "../auth/plan.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { EventsGateway } from "../events/events.gateway.js";
import { EventsModule } from "../events/events.module.js";

// ── DTO ─────────────────────────────────────────────────────────────────────

class CreateBundleMintTaskDto {
  @IsString()
  contractAddress!: string;

  @IsIn(["ETHEREUM", "BASE"])
  chain!: "ETHEREUM" | "BASE";

  @IsIn(["SEADROP", "CUSTOM"])
  kind!: "SEADROP" | "CUSTOM";

  @IsIn(["MULTI_WALLET", "SINGLE_WALLET_MULTI_TX", "EIP7702"])
  mode!: "MULTI_WALLET" | "SINGLE_WALLET_MULTI_TX" | "EIP7702";

  @IsArray()
  @IsString({ each: true })
  walletIds!: string[];

  // EIP7702 mode
  @IsOptional()
  @IsString()
  sponsorWalletId?: string;

  @IsOptional()
  @IsString()
  executorAddress?: string;

  @IsOptional()
  @IsIn(["TX_SENDER", "DELEGATED"])
  valuePayer?: "TX_SENDER" | "DELEGATED";

  @IsOptional()
  @IsString()
  startTimestampMs?: string;

  @IsObject()
  gasSettings!: Prisma.InputJsonObject;

  // SEADROP
  @IsOptional()
  @IsString()
  mintPriceWei?: string;

  // CUSTOM
  @IsOptional()
  @IsString()
  functionName?: string;

  @IsOptional()
  @IsObject()
  functionAbi?: Prisma.InputJsonObject;

  @IsOptional()
  @IsArray()
  callArgs?: Prisma.InputJsonValue[];

  @IsOptional()
  @IsString()
  valueWei?: string;

  // bundle controls
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  mintQuantity?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  txPerWallet?: number;

  @IsOptional()
  @IsString()
  targetBlock?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  blockOffset?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxBlockRetries?: number;
}

// ── Controller ────────────────────────────────────────────────────────────

@Controller("bundle-mint")
@UseGuards(AuthGuard, PlanGuard)
@ProOrAbove()
class BundleMintController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: EventsGateway,
  ) {}

  /** Create a new bundle-mint task (saved as DRAFT). */
  @Post("tasks")
  async createTask(@CurrentUser() user: CurrentUserType, @Body() body: CreateBundleMintTaskDto) {
    const addr = normalizeAddress(body.contractAddress);
    if (!addr) throw new BadRequestException("Enter a valid contract address (0x…).");

    if (!body.walletIds.length) {
      throw new BadRequestException("Select at least one wallet.");
    }
    if (body.mode === "SINGLE_WALLET_MULTI_TX" && body.walletIds.length !== 1) {
      throw new BadRequestException("Single-wallet mode requires exactly one wallet.");
    }
    if (body.kind === "CUSTOM" && (!body.functionName || !body.functionAbi)) {
      throw new BadRequestException("Custom mode requires a function name and ABI.");
    }

    if (body.mode === "EIP7702") {
      if (!body.sponsorWalletId) {
        throw new BadRequestException("EIP-7702 mode requires a sponsor (main) wallet.");
      }
      if (body.walletIds.includes(body.sponsorWalletId)) {
        throw new BadRequestException("The sponsor wallet cannot also be a sub-wallet.");
      }
      if (body.executorAddress && !normalizeAddress(body.executorAddress)) {
        throw new BadRequestException("Executor address is not a valid 0x address.");
      }
      const sponsor = await this.prisma.wallet.count({
        where: { id: body.sponsorWalletId, userId: user.id, network: body.chain },
      });
      if (sponsor !== 1) {
        throw new BadRequestException("Sponsor wallet not found on your account / wrong network.");
      }
    }

    const walletCount = await this.prisma.wallet.count({
      where: { id: { in: body.walletIds }, userId: user.id, network: body.chain },
    });
    if (walletCount !== body.walletIds.length) {
      throw new BadRequestException(
        "One or more wallets do not belong to your account or are on the wrong network.",
      );
    }

    const task = await this.prisma.bundleMintTask.create({
      data: {
        userId: user.id,
        contractAddress: addr,
        chain: body.chain,
        kind: body.kind,
        mode: body.mode,
        functionName: body.kind === "CUSTOM" ? body.functionName : null,
        functionAbi: body.kind === "CUSTOM" ? body.functionAbi : Prisma.DbNull,
        callArgs: body.kind === "CUSTOM" ? ((body.callArgs ?? []) as Prisma.InputJsonValue) : Prisma.DbNull,
        mintPriceWei: body.mintPriceWei ?? "0",
        valueWei: body.valueWei ?? "0",
        gasSettingsJson: body.gasSettings,
        mintQuantity: body.mintQuantity ?? 1,
        txPerWallet: body.txPerWallet ?? 1,
        targetBlock: body.targetBlock ?? null,
        blockOffset: body.blockOffset ?? 1,
        maxBlockRetries: body.maxBlockRetries ?? 3,
        sponsorWalletId: body.mode === "EIP7702" ? body.sponsorWalletId : null,
        executorAddress:
          body.mode === "EIP7702"
            ? body.executorAddress
              ? normalizeAddress(body.executorAddress)
              : null
            : null,
        valuePayer: body.valuePayer ?? "TX_SENDER",
        startTimestampMs:
          body.mode === "EIP7702" ? body.startTimestampMs?.trim() || null : null,
        wallets: {
          create: body.walletIds.map((walletId) => ({ walletId })),
        },
      },
      include: { wallets: true },
    });

    this.events.publish("bundle-mint.task.created", { taskId: task.id });
    return task;
  }

  /** List all bundle-mint tasks for the current user. */
  @Get("tasks")
  listTasks(@CurrentUser() user: CurrentUserType) {
    return this.prisma.bundleMintTask.findMany({
      where: { userId: user.id },
      include: { wallets: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Get a single task with logs. */
  @Get("tasks/:id")
  getTask(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    return this.prisma.bundleMintTask.findFirstOrThrow({
      where: { id, userId: user.id },
      include: {
        wallets: { include: { wallet: { select: { name: true, address: true } } } },
        logs: { orderBy: { createdAt: "asc" }, take: 200 },
      },
    });
  }

  /** Queue the task for immediate execution. */
  @Post("tasks/:id/run")
  async runTask(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    const task = await this.prisma.bundleMintTask.findFirstOrThrow({
      where: { id, userId: user.id },
    });

    if (!["DRAFT", "FAILED", "CANCELED"].includes(task.status)) {
      throw new BadRequestException(
        `Task is ${task.status} — only DRAFT / FAILED / CANCELED tasks can be run.`,
      );
    }

    await this.prisma.bundleMintTask.update({
      where: { id },
      data: { status: "RUNNING", startedAt: new Date() },
    });

    const queue = new Queue("bundle-mint-queue", {
      connection: { url: this.config.getOrThrow<string>("REDIS_URL") },
    });

    try {
      await queue.add(
        "execute-bundle-mint",
        { taskId: id },
        { jobId: `bundle-mint-${id}-${Date.now()}`, attempts: 1 },
      );
    } catch {
      await this.prisma.bundleMintTask.update({ where: { id }, data: { status: "DRAFT" } });
      throw new ServiceUnavailableException(
        "Queue unavailable. Start Redis and the worker, then try again.",
      );
    } finally {
      await queue.close().catch(() => undefined);
    }

    this.events.publish("bundle-mint.task.queued", { taskId: id });
    return { ok: true, taskId: id, status: "RUNNING" };
  }

  /** Cancel a task. */
  @Post("tasks/:id/cancel")
  async cancelTask(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    await this.prisma.bundleMintTask.findFirstOrThrow({ where: { id, userId: user.id } });
    const task = await this.prisma.bundleMintTask.update({
      where: { id },
      data: { status: "CANCELED" },
    });
    this.events.publish("bundle-mint.task.canceled", { taskId: id });
    return task;
  }

  @Delete("tasks/:id")
  async deleteTask(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    await this.prisma.bundleMintTask.findFirstOrThrow({ where: { id, userId: user.id } });
    await this.prisma.bundleMintTask.delete({ where: { id } });
    return { ok: true };
  }
}

@Module({ imports: [EventsModule], controllers: [BundleMintController] })
export class BundleMintModule {}

function normalizeAddress(raw: string): string | null {
  const t = raw.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(t) ? t.toLowerCase() : null;
}
