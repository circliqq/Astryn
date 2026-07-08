import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsIn, IsNumber, IsOptional, IsString, Min } from "class-validator";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { EliteOnly, PlanGuard } from "../auth/plan.guard.js";
import { EventsGateway } from "../events/events.gateway.js";
import { EventsModule } from "../events/events.module.js";
import { PrismaService } from "../prisma/prisma.service.js";

class CreateSniperTaskDto {
  @IsString()
  walletId!: string;

  @IsIn(["FAT_FINGER", "RARITY"])
  type!: "FAT_FINGER" | "RARITY";

  @IsOptional()
  @IsString()
  collectionSlug?: string;

  @IsOptional()
  @IsString()
  contractAddress?: string;

  @IsIn(["BASE", "ETHEREUM", "ROBINHOOD"])
  network!: "BASE" | "ETHEREUM" | "ROBINHOOD";

  @IsString()
  maxPriceWei!: string;

  @IsOptional()
  @IsString()
  minPriceWei?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  floorThreshold?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minRarityScore?: number;
}

@Controller("sniper")
@UseGuards(AuthGuard, PlanGuard)
@EliteOnly()
class SniperController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  @Post()
  async create(@CurrentUser() user: CurrentUserType, @Body() body: CreateSniperTaskDto) {
    if (body.type === "FAT_FINGER" && body.floorThreshold == null) {
      throw new BadRequestException("floorThreshold is required for FAT_FINGER sniper tasks.");
    }
    if (body.type === "RARITY" && body.minRarityScore == null) {
      throw new BadRequestException("minRarityScore is required for RARITY sniper tasks.");
    }

    const wallet = await this.prisma.wallet.findFirst({ where: { id: body.walletId, userId: user.id } });
    if (!wallet) throw new BadRequestException("Wallet not found or does not belong to your account.");

    const task = await this.prisma.sniperTask.create({
      data: {
        userId: user.id,
        walletId: body.walletId,
        type: body.type,
        collectionSlug: body.collectionSlug,
        contractAddress: body.contractAddress,
        network: body.network,
        maxPriceWei: body.maxPriceWei,
        minPriceWei: body.minPriceWei,
        quantity: body.quantity ?? 1,
        floorThreshold: body.floorThreshold,
        minRarityScore: body.minRarityScore,
        status: "WATCHING",
      },
      include: { wallet: { select: { id: true, name: true, address: true } } },
    });

    this.events.publish("sniper.task.created", { userId: user.id, task });
    return task;
  }

  @Get()
  list(@CurrentUser() user: CurrentUserType) {
    return this.prisma.sniperTask.findMany({
      where: { userId: user.id },
      include: { wallet: { select: { id: true, name: true, address: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  @Patch(":id/pause")
  async pause(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    const task = await this.prisma.sniperTask.findFirst({ where: { id, userId: user.id } });
    if (!task) throw new NotFoundException("Sniper task not found.");
    if (!["WATCHING", "TRIGGERED"].includes(task.status)) {
      throw new BadRequestException(`Task is ${task.status} — only WATCHING or TRIGGERED tasks can be paused.`);
    }

    const updated = await this.prisma.sniperTask.update({ where: { id }, data: { status: "PAUSED" } });
    this.events.publish("sniper.task.updated", { userId: user.id, task: updated });
    return updated;
  }

  @Patch(":id/resume")
  async resume(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    const task = await this.prisma.sniperTask.findFirst({ where: { id, userId: user.id } });
    if (!task) throw new NotFoundException("Sniper task not found.");
    if (task.status !== "PAUSED") {
      throw new BadRequestException(`Task is ${task.status} — only PAUSED tasks can be resumed.`);
    }

    const updated = await this.prisma.sniperTask.update({ where: { id }, data: { status: "WATCHING" } });
    this.events.publish("sniper.task.updated", { userId: user.id, task: updated });
    return updated;
  }

  @Delete(":id")
  async remove(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    const task = await this.prisma.sniperTask.findFirst({ where: { id, userId: user.id } });
    if (!task) throw new NotFoundException("Sniper task not found.");

    await this.prisma.sniperTask.delete({ where: { id } });
    return { ok: true };
  }
}

@Module({ imports: [EventsModule], controllers: [SniperController] })
export class SniperModule {}
