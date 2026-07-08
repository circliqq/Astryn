import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsArray, IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsString, Max, Min } from "class-validator";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { NotificationsModule, NotificationsService } from "./notifications.module.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Supported reminder intervals in minutes */
export const SUPPORTED_ALERT_MINUTES = [60, 30, 15, 5] as const;

// ── DTOs ──────────────────────────────────────────────────────────────────────

class CreateMintAlertDto {
  @IsString()
  collectionSlug!: string;

  @IsString()
  collectionName!: string;

  @IsIn(["BASE", "ETHEREUM", "ROBINHOOD"])
  network!: "BASE" | "ETHEREUM" | "ROBINHOOD";

  @IsISO8601()
  mintStartTime!: string;

  @IsArray()
  @IsNumber({}, { each: true })
  alertMinutes!: number[];
}

class UpdateMintAlertDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsISO8601()
  mintStartTime?: string;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  alertMinutes?: number[];

  @IsOptional()
  @IsString()
  collectionName?: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class MintAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Poll all enabled mint alerts and fire notifications for due intervals.
   * Called every minute by the scheduler worker or health endpoint.
   * An interval is "due" if now is within 90s of (mintStartTime - interval minutes).
   */
  async checkDue(): Promise<{ fired: number; skipped: number }> {
    const now = new Date();

    // Only consider alerts whose mint is in the future (or just passed — up to 2min grace)
    const twoMinAgo = new Date(now.getTime() - 2 * 60_000);
    const alerts = await this.prisma.mintAlert.findMany({
      where: {
        enabled: true,
        mintStartTime: { gte: twoMinAgo },
      },
    });

    let fired = 0;
    let skipped = 0;

    for (const alert of alerts) {
      const mintTime = new Date(alert.mintStartTime).getTime();
      const nowMs = now.getTime();

      const newlyFired: number[] = [];

      for (const minutes of alert.alertMinutes) {
        // Already sent for this interval?
        if ((alert.firedMinutes as number[]).includes(minutes)) {
          skipped++;
          continue;
        }

        // Target fire time = mintStartTime - minutes
        const targetMs = mintTime - minutes * 60_000;
        const diffMs = nowMs - targetMs; // positive = we are past the target

        // Fire if we are within a 90-second window past the target
        if (diffMs >= 0 && diffMs <= 90_000) {
          newlyFired.push(minutes);

          const timeLabel =
            minutes === 60 ? "1 hour" :
            minutes === 30 ? "30 minutes" :
            minutes === 15 ? "15 minutes" :
            `${minutes} minutes`;

          await this.notifications.sendNotification(alert.userId, "MINT_REMINDER", {
            collectionSlug: alert.collectionSlug,
            collectionName: alert.collectionName,
            network: alert.network,
            mintStartTime: alert.mintStartTime.toISOString(),
            reminderIn: timeLabel,
            message: `⏰ Mint starts in ${timeLabel}: ${alert.collectionName} (${alert.network})`,
          });

          fired++;
        }
      }

      if (newlyFired.length > 0) {
        await this.prisma.mintAlert.update({
          where: { id: alert.id },
          data: {
            firedMinutes: {
              set: [...(alert.firedMinutes as number[]), ...newlyFired],
            },
          },
        });
      }
    }

    return { fired, skipped };
  }
}

// ── Controller ────────────────────────────────────────────────────────────────

@Controller("mint-alerts")
@UseGuards(AuthGuard)
class MintAlertsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mintAlertsService: MintAlertsService,
  ) {}

  @Get()
  list(@CurrentUser() user: CurrentUserType) {
    return this.prisma.mintAlert.findMany({
      where: { userId: user.id },
      orderBy: { mintStartTime: "asc" },
    });
  }

  @Post()
  async create(@CurrentUser() user: CurrentUserType, @Body() body: CreateMintAlertDto) {
    const validMinutes = body.alertMinutes.filter((m) =>
      SUPPORTED_ALERT_MINUTES.includes(m as typeof SUPPORTED_ALERT_MINUTES[number])
    );

    return this.prisma.mintAlert.create({
      data: {
        userId: user.id,
        collectionSlug: body.collectionSlug.trim().toLowerCase(),
        collectionName: body.collectionName.trim(),
        network: body.network,
        mintStartTime: new Date(body.mintStartTime),
        alertMinutes: validMinutes,
        firedMinutes: [],
        enabled: true,
      },
    });
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: CurrentUserType,
    @Param("id") id: string,
    @Body() body: UpdateMintAlertDto,
  ) {
    const alert = await this.prisma.mintAlert.findFirst({ where: { id, userId: user.id } });
    if (!alert) throw new NotFoundException("Mint alert not found.");

    const data: Record<string, unknown> = {};
    if (body.enabled !== undefined) data.enabled = body.enabled;
    if (body.collectionName !== undefined) data.collectionName = body.collectionName.trim();
    if (body.mintStartTime !== undefined) {
      data.mintStartTime = new Date(body.mintStartTime);
      // Reset fired intervals when mint time changes
      data.firedMinutes = [];
    }
    if (body.alertMinutes !== undefined) {
      data.alertMinutes = body.alertMinutes.filter((m) =>
        SUPPORTED_ALERT_MINUTES.includes(m as typeof SUPPORTED_ALERT_MINUTES[number])
      );
    }

    return this.prisma.mintAlert.update({ where: { id }, data });
  }

  @Delete(":id")
  async remove(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    const alert = await this.prisma.mintAlert.findFirst({ where: { id, userId: user.id } });
    if (!alert) throw new NotFoundException("Mint alert not found.");
    await this.prisma.mintAlert.delete({ where: { id } });
    return { ok: true };
  }

  /** Trigger a due-check manually (for testing or external cron) */
  @Post("check-due")
  async checkDue() {
    return this.mintAlertsService.checkDue();
  }
}

// ── Module ────────────────────────────────────────────────────────────────────

@Module({
  imports: [NotificationsModule],
  controllers: [MintAlertsController],
  providers: [MintAlertsService],
  exports: [MintAlertsService],
})
export class MintAlertsModule {}
