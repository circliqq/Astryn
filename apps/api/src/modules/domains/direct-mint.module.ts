import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  Param,
  Post,
  Delete,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue } from "bullmq";
import { type Prisma } from "@prisma/client";
import { IsArray, IsIn, IsNumber, IsObject, IsOptional, IsString, Min, Max } from "class-validator";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PlanGuard, ProOrAbove } from "../auth/plan.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { EventsGateway } from "../events/events.gateway.js";
import { EventsModule } from "../events/events.module.js";

// ── DTOs ──────────────────────────────────────────────────────────────────

class FetchAbiDto {
  @IsString()
  contractAddress!: string;

  @IsIn(["ethereum", "base"])
  chain!: "ethereum" | "base";
}

class CreateDirectMintTaskDto {
  @IsString()
  contractAddress!: string;

  @IsIn(["ETHEREUM", "BASE"])
  chain!: "ETHEREUM" | "BASE";

  @IsString()
  functionName!: string;

  @IsObject()
  functionAbi!: Prisma.InputJsonObject;

  @IsArray()
  callArgs!: Prisma.InputJsonValue[];

  @IsOptional()
  @IsString()
  valueWei?: string;

  @IsArray()
  @IsString({ each: true })
  walletIds!: string[];

  @IsObject()
  gasSettings!: Prisma.InputJsonObject;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  mintQuantity?: number;
}

// ── Controller ────────────────────────────────────────────────────────────

@Controller("direct-mint")
@UseGuards(AuthGuard, PlanGuard)
@ProOrAbove()
class DirectMintController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: EventsGateway,
  ) {}

  /**
   * Fetch verified ABI for a contract from Etherscan.
   * Returns only the "write" (nonpayable + payable) functions.
   */
  @Post("fetch-abi")
  async fetchAbi(@Body() body: FetchAbiDto) {
    const addr = normalizeAddress(body.contractAddress);
    if (!addr) throw new BadRequestException("Enter a valid contract address (0x…).");

    const apiKey = this.config.get<string>("ETHERSCAN_API_KEY") ?? "";
    const baseUrl =
      body.chain === "base"
        ? "https://api.basescan.org/api"
        : "https://api.etherscan.io/api";

    const url = `${baseUrl}?module=contract&action=getabi&address=${addr}${apiKey ? `&apikey=${apiKey}` : ""}`;

    let abi: unknown[];
    try {
      const res = await fetch(url);
      const json = (await res.json()) as { status: string; result: string; message?: string };
      if (json.status !== "1") {
        throw new BadRequestException(
          json.result === "Contract source code not verified"
            ? "Contract ABI is not verified on Etherscan. You can still mint by entering the function selector manually."
            : `Etherscan: ${json.message ?? json.result}`,
        );
      }
      abi = JSON.parse(json.result) as unknown[];
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException("Failed to fetch ABI from Etherscan. Check your network or try again.");
    }

    // Filter to write functions only (payable + nonpayable, no view/pure)
    const writeFunctions = abi.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as Record<string, unknown>)["type"] === "function" &&
        ["payable", "nonpayable"].includes(
          String((entry as Record<string, unknown>)["stateMutability"] ?? "")
        ),
    );

    return { contractAddress: addr, chain: body.chain, functions: writeFunctions };
  }

  /** Create a new direct-mint task (saved as DRAFT). */
  @Post("tasks")
  async createTask(@CurrentUser() user: CurrentUserType, @Body() body: CreateDirectMintTaskDto) {
    if (!body.walletIds.length) {
      throw new BadRequestException("Select at least one wallet.");
    }

    const addr = normalizeAddress(body.contractAddress);
    if (!addr) throw new BadRequestException("Invalid contract address.");

    const walletCount = await this.prisma.wallet.count({
      where: { id: { in: body.walletIds }, userId: user.id },
    });
    if (walletCount !== body.walletIds.length) {
      throw new BadRequestException("One or more wallets do not belong to your account.");
    }

    const task = await this.prisma.directMintTask.create({
      data: {
        userId: user.id,
        contractAddress: addr,
        chain: body.chain,
        functionName: body.functionName,
        functionAbi: body.functionAbi,
        callArgs: body.callArgs as Prisma.InputJsonValue,
        valueWei: body.valueWei ?? "0",
        gasSettingsJson: body.gasSettings,
        mintQuantity: body.mintQuantity ?? 1,
        wallets: {
          create: body.walletIds.map((walletId) => ({
            walletId,
            mintQuantity: body.mintQuantity ?? 1,
          })),
        },
      },
      include: { wallets: true },
    });

    this.events.publish("direct-mint.task.created", { taskId: task.id });
    return task;
  }

  /** List all direct-mint tasks for the current user. */
  @Get("tasks")
  listTasks(@CurrentUser() user: CurrentUserType) {
    return this.prisma.directMintTask.findMany({
      where: { userId: user.id },
      include: { wallets: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Get a single task with full details. */
  @Get("tasks/:id")
  getTask(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    return this.prisma.directMintTask.findFirstOrThrow({
      where: { id, userId: user.id },
      include: { wallets: true, logs: { orderBy: { createdAt: "asc" }, take: 200 } },
    });
  }

  /** Queue the task for immediate execution. */
  @Post("tasks/:id/run")
  async runTask(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    const task = await this.prisma.directMintTask.findFirstOrThrow({
      where: { id, userId: user.id },
    });

    if (!["DRAFT", "FAILED", "CANCELED"].includes(task.status)) {
      throw new BadRequestException(`Task is ${task.status} — only DRAFT / FAILED / CANCELED tasks can be run.`);
    }

    await this.prisma.directMintTask.update({
      where: { id },
      data: { status: "RUNNING", startedAt: new Date() },
    });

    const queue = new Queue("direct-mint-queue", {
      connection: { url: this.config.getOrThrow<string>("REDIS_URL") },
    });

    try {
      await queue.add(
        "execute-direct-mint",
        { taskId: id },
        { jobId: `direct-mint-${id}-${Date.now()}`, attempts: 1 },
      );
    } catch {
      await this.prisma.directMintTask.update({ where: { id }, data: { status: "DRAFT" } });
      throw new ServiceUnavailableException(
        "Queue unavailable. Start Redis and the worker, then try again.",
      );
    } finally {
      await queue.close().catch(() => undefined);
    }

    this.events.publish("direct-mint.task.queued", { taskId: id });
    return { ok: true, taskId: id, status: "RUNNING" };
  }

  /** Cancel / delete a task. */
  @Post("tasks/:id/cancel")
  async cancelTask(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    await this.prisma.directMintTask.findFirstOrThrow({ where: { id, userId: user.id } });
    const task = await this.prisma.directMintTask.update({
      where: { id },
      data: { status: "CANCELED" },
    });
    this.events.publish("direct-mint.task.canceled", { taskId: id });
    return task;
  }

  @Delete("tasks/:id")
  async deleteTask(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    await this.prisma.directMintTask.findFirstOrThrow({ where: { id, userId: user.id } });
    await this.prisma.directMintTask.delete({ where: { id } });
    return { ok: true };
  }
}

@Module({ imports: [EventsModule], controllers: [DirectMintController] })
export class DirectMintModule {}

function normalizeAddress(raw: string): string | null {
  const t = raw.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(t) ? t.toLowerCase() : null;
}
