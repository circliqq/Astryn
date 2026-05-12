import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Module,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsBoolean, IsIn, IsOptional, IsString } from "class-validator";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";

class CreateCollectionWatchDto {
  @IsString()
  collectionSlug!: string;

  @IsIn(["BASE", "ETHEREUM"])
  network!: "BASE" | "ETHEREUM";

  @IsBoolean()
  @IsOptional()
  alertOnPhase?: boolean;

  @IsBoolean()
  @IsOptional()
  alertOnSupply?: boolean;

  @IsBoolean()
  @IsOptional()
  alertOnPrice?: boolean;
}

@Controller("collection-watches")
@UseGuards(AuthGuard)
class CollectionWatchController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserType) {
    return this.prisma.collectionWatch.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
  }

  @Post()
  async create(@CurrentUser() user: CurrentUserType, @Body() body: CreateCollectionWatchDto) {
    try {
      return await this.prisma.collectionWatch.create({
        data: {
          userId: user.id,
          collectionSlug: body.collectionSlug,
          network: body.network,
          alertOnPhase: body.alertOnPhase ?? true,
          alertOnSupply: body.alertOnSupply ?? true,
          alertOnPrice: body.alertOnPrice ?? true,
        },
      });
    } catch {
      throw new BadRequestException("Collection watch already exists for this slug and network.");
    }
  }

  @Delete(":id")
  async remove(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    const watch = await this.prisma.collectionWatch.findFirst({ where: { id, userId: user.id } });
    if (!watch) throw new NotFoundException("Collection watch not found.");
    await this.prisma.collectionWatch.delete({ where: { id } });
    return { ok: true };
  }
}

@Module({ controllers: [CollectionWatchController] })
export class CollectionWatchModule {}
