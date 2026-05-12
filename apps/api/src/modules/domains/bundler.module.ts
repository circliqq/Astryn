import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IsOptional, IsString } from "class-validator";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { EventsGateway } from "../events/events.gateway.js";
import { EventsModule } from "../events/events.module.js";
import { PrismaService } from "../prisma/prisma.service.js";

class CreateBundleDto {
  @IsString()
  mintTaskId!: string;

  @IsOptional()
  @IsString()
  targetBlock?: string;
}

@Controller("bundles")
@UseGuards(AuthGuard)
class BundlerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: EventsGateway,
  ) {}

  @Post()
  async create(@CurrentUser() user: CurrentUserType, @Body() body: CreateBundleDto) {
    const task = await this.prisma.mintTask.findFirst({
      where: { id: body.mintTaskId, userId: user.id },
      include: { transactions: true, collection: true },
    });
    if (!task) throw new NotFoundException("Mint task not found.");

    const signedTxs = task.transactions
      .filter((tx) => tx.status !== "FAILED")
      .map((tx) => tx.txHash)
      .filter(Boolean) as string[];

    if (signedTxs.length === 0) {
      throw new BadRequestException("No broadcastable transactions found on this mint task.");
    }

    const network = task.collection.chain;
    const bundle = await this.prisma.txBundle.create({
      data: {
        userId: user.id,
        mintTaskId: task.id,
        network,
        txCount: signedTxs.length,
        targetBlock: body.targetBlock,
        status: "PENDING",
      },
    });

    // Submit to Flashbots relay asynchronously
    void this.submitBundle(bundle.id, network, signedTxs, body.targetBlock).catch(() => undefined);

    this.events.publish("bundle.status.changed", { bundleId: bundle.id, userId: user.id, status: "PENDING" });
    return bundle;
  }

  @Get()
  list(@CurrentUser() user: CurrentUserType) {
    return this.prisma.txBundle.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
  }

  @Get(":id")
  async get(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    const bundle = await this.prisma.txBundle.findFirst({ where: { id, userId: user.id } });
    if (!bundle) throw new NotFoundException("Bundle not found.");
    return bundle;
  }

  private async submitBundle(
    bundleId: string,
    network: "BASE" | "ETHEREUM",
    signedTxs: string[],
    targetBlock?: string,
  ) {
    const relayUrl =
      network === "BASE"
        ? "https://relay.flashbots-base.net"
        : "https://relay.flashbots.net";

    const blockParam = targetBlock
      ? { blockNumber: targetBlock }
      : {};

    try {
      const res = await fetch(relayUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_sendBundle",
          params: [{ txs: signedTxs, ...blockParam }],
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`Flashbots relay responded with ${res.status}: ${text}`);
      }

      const data = (await res.json()) as { result?: { bundleHash?: string }; error?: { message?: string } };

      if (data.error) {
        throw new Error(data.error.message ?? "Flashbots relay returned an error.");
      }

      const bundleHash = data.result?.bundleHash;
      const updated = await this.prisma.txBundle.update({
        where: { id: bundleId },
        data: { status: "SUBMITTED", bundleHash: bundleHash ?? null },
      });
      this.events.publish("bundle.status.changed", { bundleId, userId: updated.userId, status: "SUBMITTED", bundleHash });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const updated = await this.prisma.txBundle.update({
        where: { id: bundleId },
        data: { status: "FAILED", errorMessage: msg },
      });
      this.events.publish("bundle.status.changed", { bundleId, userId: updated.userId, status: "FAILED", error: msg });
    }
  }
}

@Module({ imports: [EventsModule], controllers: [BundlerController] })
export class BundlerModule {}
