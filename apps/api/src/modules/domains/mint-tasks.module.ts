import { BadRequestException, Body, Controller, Get, Module, Param, Patch, Post, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { Queue } from "bullmq";
import { ConfigService } from "@nestjs/config";
import { MintPhaseType, type Prisma } from "@prisma/client";
import { IsArray, IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, Max, Min, IsDateString } from "class-validator";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { EventsGateway } from "../events/events.gateway.js";
import { EventsModule } from "../events/events.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { collectionInclude, getCollectionWithPhaseData, resolveScheduleAtFromPhase } from "./collection-phase.utils.js";
import { ensureSchedulerReady } from "./scheduler-readiness.js";

class CreateMintTaskDto {
  @IsString()
  collectionId!: string;

  @IsArray()
  @IsString({ each: true })
  walletIds!: string[];

  @IsIn(["PUBLIC", "ALLOWLIST", "GTD", "FCFS"])
  phaseType!: MintPhaseType;

  @IsObject()
  gasSettings!: Prisma.InputJsonObject;

  @IsOptional()
  @IsString()
  scheduleAt?: string;

  @IsOptional()
  @IsIn(["draft", "phase_start"])
  scheduleMode?: "draft" | "phase_start";

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  mintQuantity?: number;

  @IsOptional()
  @IsObject()
  walletMintQuantities?: Record<string, number>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  priorityWalletIds?: string[];

  @IsOptional()
  @IsObject()
  priorityMinting?: Prisma.InputJsonObject;

  @IsOptional()
  @IsObject()
  instantFlipper?: Prisma.InputJsonObject;
}

class UpdateMintTaskDto {
  @IsOptional()
  @IsIn(["PUBLIC", "ALLOWLIST", "GTD", "FCFS"])
  phaseType?: MintPhaseType;

  @IsOptional()
  @IsObject()
  gasSettings?: Prisma.InputJsonObject;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  mintQuantity?: number;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsIn(["draft", "phase_start"])
  scheduleMode?: "draft" | "phase_start";
}

class WalletGasOverrideDto {
  [key: string]: Prisma.InputJsonValue | null | undefined;

  @IsIn(["safe", "balanced", "aggressive"])
  mode!: "safe" | "balanced" | "aggressive";

  @IsNumber()
  maxFeeGwei!: number;

  @IsNumber()
  priorityFeeGwei!: number;

  @IsNumber()
  maxTotalGasCostEth!: number;

  @IsBoolean()
  gasBumpEnabled!: boolean;

  @IsNumber()
  maxBumpAttempts!: number;
}

@Controller("mint-tasks")
@UseGuards(AuthGuard)
class MintTasksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: EventsGateway
  ) {}

  @Post()
  async create(@CurrentUser() user: CurrentUserType, @Body() body: CreateMintTaskDto) {
    if (body.walletIds.length === 0) {
      throw new BadRequestException("Select at least one wallet before creating a mint task.");
    }

    const collection =
      body.scheduleMode === "phase_start"
        ? (await getCollectionWithPhaseData(this.prisma, this.config, body.collectionId, { requireLive: true })).collection
        : await this.prisma.collection.findUniqueOrThrow({
            where: { id: body.collectionId },
            include: collectionInclude
          });
    const walletCount = await this.prisma.wallet.count({
      where: { id: { in: body.walletIds }, userId: user.id }
    });
    if (walletCount !== body.walletIds.length) {
      throw new BadRequestException("One or more selected wallets do not belong to your account.");
    }

    const scheduleAt =
      body.scheduleMode === "phase_start"
        ? resolveScheduleAtFromPhase(collection.phases, body.phaseType)
        : body.scheduleAt
          ? new Date(body.scheduleAt)
          : null;

    if (scheduleAt && Number.isNaN(scheduleAt.getTime())) {
      throw new BadRequestException("Invalid schedule time.");
    }

    const phaseLimit = collection.phases?.find((phase) => phase.phaseType === body.phaseType)?.maxMint ?? null;
    const collectionLimit = collection.maxMint ?? null;
    const maxAllowed = phaseLimit ?? collectionLimit ?? 50;
    const quantityByWalletId = new Map<string, number>();

    for (const walletId of body.walletIds) {
      const rawQuantity = body.walletMintQuantities?.[walletId] ?? body.mintQuantity ?? 1;
      const quantity = Math.max(1, Math.floor(Number(rawQuantity)));
      if (!Number.isFinite(quantity) || quantity > maxAllowed) {
        throw new BadRequestException(`Mint quantity for one or more wallets exceeds the per-wallet limit of ${maxAllowed}.`);
      }
      quantityByWalletId.set(walletId, quantity);
    }

    const priorityRankByWalletId = new Map((body.priorityWalletIds ?? []).map((walletId, index) => [walletId, index]));
    const priorityMinting = body.priorityMinting
      ? {
          ...body.priorityMinting,
          priorityWalletIds: (body.priorityWalletIds ?? []).filter((walletId) => body.walletIds.includes(walletId))
        }
      : undefined;

    if (scheduleAt) {
      await ensureSchedulerReady(this.config);
    }

    const task = await this.prisma.mintTask.create({
      data: {
        userId: user.id,
        collectionId: body.collectionId,
        phaseType: body.phaseType,
        status: scheduleAt ? "SCHEDULED" : "DRAFT",
        scheduledAt: scheduleAt ?? undefined,
        gasSettingsJson: body.gasSettings,
        mintQuantity: body.mintQuantity ?? 1,
        priorityMintingJson: priorityMinting,
        instantFlipperJson: body.instantFlipper,
        wallets: {
          create: body.walletIds.map((walletId) => ({
            walletId,
            mintQuantity: quantityByWalletId.get(walletId) ?? body.mintQuantity ?? 1,
            priorityMint: priorityRankByWalletId.has(walletId),
            priorityRank: priorityRankByWalletId.get(walletId)
          }))
        }
      },
      include: { wallets: true, collection: true }
    });

    if (scheduleAt) {
      try {
        await this.scheduleMintTaskExecution(task.id, scheduleAt);
      } catch (error) {
        await this.prisma.mintTask.delete({ where: { id: task.id } }).catch(() => undefined);
        throw error;
      }
    }

    this.events.publish("task.status.updated", { taskId: task.id, status: task.status });
    return task;
  }

  @Get()
  list(@CurrentUser() user: CurrentUserType) {
    return this.prisma.mintTask.findMany({
      where: { userId: user.id },
      include: { collection: true, wallets: true },
      orderBy: { createdAt: "desc" }
    });
  }

  @Get(":id")
  get(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    return this.prisma.mintTask.findFirstOrThrow({
      where: { id, userId: user.id },
      include: { collection: true, wallets: true, transactions: true, logs: true, report: true }
    });
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: CurrentUserType,
    @Param("id") id: string,
    @Body() body: UpdateMintTaskDto,
  ) {
    const existing = await this.prisma.mintTask.findFirstOrThrow({ where: { id, userId: user.id } });

    const editableStatuses = ["DRAFT", "SCHEDULED", "PAUSED"];
    if (!editableStatuses.includes(existing.status)) {
      throw new BadRequestException(`Task is ${existing.status} — only DRAFT, SCHEDULED, or PAUSED tasks can be edited.`);
    }

    const updateData: Prisma.MintTaskUpdateInput = {};

    if (body.gasSettings !== undefined) {
      updateData.gasSettingsJson = body.gasSettings;
    }
    if (body.mintQuantity !== undefined) {
      updateData.mintQuantity = body.mintQuantity;
    }
    if (body.phaseType !== undefined) {
      updateData.phaseType = body.phaseType;
    }

    if (body.scheduleMode === "draft") {
      // Clear schedule → back to draft
      updateData.scheduledAt = null;
      updateData.status = "DRAFT";
      await this.removeQueuedTask(id);
    } else if (body.scheduledAt) {
      const scheduleAt = new Date(body.scheduledAt);
      if (Number.isNaN(scheduleAt.getTime())) {
        throw new BadRequestException("Invalid schedule time.");
      }
      await ensureSchedulerReady(this.config);
      updateData.scheduledAt = scheduleAt;
      updateData.status = "SCHEDULED";
      // Replace existing queued job
      await this.removeQueuedTask(id);
      await this.scheduleMintTaskExecution(id, scheduleAt);
    }

    const task = await this.prisma.mintTask.update({ where: { id }, data: updateData });
    this.events.publish("task.status.updated", { taskId: task.id, status: task.status });
    return task;
  }

  @Post(":id/schedule")
  async schedule(
    @CurrentUser() user: CurrentUserType,
    @Param("id") id: string,
    @Body() body: { scheduleAt: string }
  ) {
    const existing = await this.prisma.mintTask.findFirstOrThrow({ where: { id, userId: user.id } });

    const scheduleAt = new Date(body.scheduleAt);
    if (Number.isNaN(scheduleAt.getTime())) {
      throw new BadRequestException("Invalid schedule time.");
    }

    await ensureSchedulerReady(this.config);

    const previousState = { status: existing.status, scheduledAt: existing.scheduledAt };
    const task = await this.prisma.mintTask.update({ where: { id }, data: { scheduledAt: scheduleAt, status: "SCHEDULED" } });

    try {
      await this.scheduleMintTaskExecution(id, scheduleAt);
    } catch (error) {
      await this.prisma.mintTask
        .update({
          where: { id },
          data: { status: previousState.status, scheduledAt: previousState.scheduledAt ?? undefined }
        })
        .catch(() => undefined);
      throw error;
    }

    this.events.publish("task.status.updated", { taskId: task.id, status: task.status });
    return task;
  }

  @Post(":id/pause")
  async pause(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    const existing = await this.prisma.mintTask.findFirstOrThrow({
      where: { id, userId: user.id }
    });

    if (!["SCHEDULED", "RUNNING"].includes(existing.status)) {
      return { ok: false, message: `Task is ${existing.status} - only SCHEDULED or RUNNING tasks can be paused.` };
    }

    await this.removeQueuedTask(id);

    const task = await this.prisma.mintTask.update({
      where: { id },
      data: { status: "PAUSED" }
    });
    this.events.publish("task.status.updated", { taskId: task.id, status: task.status });
    return task;
  }

  @Post(":id/resume")
  async resume(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    const existing = await this.prisma.mintTask.findFirstOrThrow({
      where: { id, userId: user.id }
    });

    if (existing.status !== "PAUSED") {
      return { ok: false, message: `Task is ${existing.status} - only PAUSED tasks can be resumed.` };
    }

    const scheduleAt = existing.scheduledAt && existing.scheduledAt > new Date() ? existing.scheduledAt : new Date();
    await ensureSchedulerReady(this.config);

    const previousState = { status: existing.status, scheduledAt: existing.scheduledAt };
    const task = await this.prisma.mintTask.update({
      where: { id },
      data: { status: "SCHEDULED", scheduledAt: scheduleAt }
    });

    try {
      await this.scheduleMintTaskExecution(id, scheduleAt);
    } catch (error) {
      await this.prisma.mintTask
        .update({
          where: { id },
          data: { status: previousState.status, scheduledAt: previousState.scheduledAt ?? undefined }
        })
        .catch(() => undefined);
      throw error;
    }

    this.events.publish("task.status.updated", { taskId: task.id, status: task.status });
    return task;
  }

  @Post(":id/cancel")
  async cancel(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    await this.prisma.mintTask.findFirstOrThrow({ where: { id, userId: user.id } });

    await this.removeQueuedTask(id);

    const task = await this.prisma.mintTask.update({ where: { id }, data: { status: "CANCELED" } });
    this.events.publish("task.status.updated", { taskId: task.id, status: task.status });
    return task;
  }

  @Post(":id/flip")
  async flip(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    const task = await this.prisma.mintTask.findFirstOrThrow({
      where: { id, userId: user.id },
      include: { collection: true, wallets: { include: { wallet: true } } }
    });

    if (task.status !== "COMPLETED") {
      throw new BadRequestException("Only COMPLETED tasks can be flipped.");
    }

    const flipper = task.instantFlipperJson as Record<string, unknown> | null;
    if (!flipper?.enabled) {
      throw new BadRequestException("Instant Flipper is not enabled on this task.");
    }

    if (flipper.mode !== "manual") {
      throw new BadRequestException("Use auto mode or wait — this task has auto-flip enabled.");
    }

    // Queue the flip job
    const queue = new Queue("mint-task-queue", {
      connection: { url: this.config.getOrThrow<string>("REDIS_URL") }
    });

    try {
      await queue.add(
        "instant-flip",
        { taskId: task.id, manual: true },
        { jobId: `flip-${task.id}-${Date.now()}`, attempts: 2 }
      );
    } finally {
      await queue.close().catch(() => undefined);
    }

    this.events.publish("task.flip.queued", { taskId: task.id });
    return { ok: true, message: "Flip job queued. NFTs will be listed on OpenSea shortly." };
  }

  @Post(":id/retry")
  async retry(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    const existing = await this.prisma.mintTask.findFirstOrThrow({
      where: { id, userId: user.id }
    });

    if (!["FAILED", "CANCELED"].includes(existing.status)) {
      return {
        ok: false,
        message: `Task is ${existing.status} — only FAILED or CANCELED tasks can be retried.`
      };
    }

    const task = await this.prisma.mintTask.update({
      where: { id },
      data: { status: "DRAFT" }
    });

    this.events.publish("task.status.updated", { taskId: task.id, status: task.status });
    return { ok: true, task };
  }

  @Patch(":taskId/wallets/:walletId/gas")
  async setWalletGas(
    @CurrentUser() user: CurrentUserType,
    @Param("taskId") taskId: string,
    @Param("walletId") walletId: string,
    @Body() body: WalletGasOverrideDto
  ) {
    await this.prisma.mintTask.findFirstOrThrow({ where: { id: taskId, userId: user.id } });

    const taskWallet = await this.prisma.mintTaskWallet.findFirstOrThrow({
      where: { mintTaskId: taskId, walletId }
    });

    const updated = await this.prisma.mintTaskWallet.update({
      where: { id: taskWallet.id },
      data: { gasSettingsJson: body as Prisma.InputJsonObject }
    });

    this.events.publish("task.wallet.gas.updated", { taskId, walletId, gasSettings: body });
    return updated;
  }

  @Get(":taskId/wallets/:walletId/gas")
  async getWalletGas(
    @CurrentUser() user: CurrentUserType,
    @Param("taskId") taskId: string,
    @Param("walletId") walletId: string
  ) {
    await this.prisma.mintTask.findFirstOrThrow({ where: { id: taskId, userId: user.id } });

    const taskWallet = await this.prisma.mintTaskWallet.findFirstOrThrow({
      where: { mintTaskId: taskId, walletId }
    });

    return {
      walletId,
      taskId,
      gasSettingsJson: taskWallet.gasSettingsJson ?? null,
      usingOverride: taskWallet.gasSettingsJson !== null
    };
  }

  private async scheduleMintTaskExecution(taskId: string, runAt: Date) {
    const prepLeadMs = this.mintPrepLeadMs();
    const delay = Math.max(0, runAt.getTime() - Date.now() - prepLeadMs);
    const jobId = queueJobId(taskId);
    const queue = new Queue("mint-task-queue", {
      connection: { url: this.config.getOrThrow<string>("REDIS_URL") }
    });

    try {
      const existing = await queue.getJob(jobId);
      if (existing) await existing.remove();
      await queue.add("execute-mint-task", { taskId, runAt: runAt.toISOString() }, { delay, jobId });
    } catch {
      throw new ServiceUnavailableException(
        "Scheduling is unavailable right now. Start Redis and the worker, then try again, or save this task as a draft."
      );
    } finally {
      await queue.close().catch(() => undefined);
    }
  }

  private async removeQueuedTask(taskId: string) {
    const jobId = queueJobId(taskId);
    const queue = new Queue("mint-task-queue", {
      connection: { url: this.config.getOrThrow<string>("REDIS_URL") }
    });

    try {
      const job = await queue.getJob(jobId);
      if (job) await job.remove();
    } catch {
      // Ignore queue cleanup errors when Redis is not available.
    } finally {
      await queue.close().catch(() => undefined);
    }
  }

  private mintPrepLeadMs() {
    const raw = this.config.get<string>("MINT_PREP_LEAD_MS");
    const parsed = raw ? Number(raw) : 90_000;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 90_000;
  }
}

@Module({ imports: [EventsModule], controllers: [MintTasksController] })
export class MintTasksModule {}

function queueJobId(taskId: string) {
  return `task-${taskId}`;
}
