import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac } from "node:crypto";
import { IsArray, IsBoolean, IsIn, IsObject, IsOptional } from "class-validator";
import { Prisma, type NotificationEvent, type NotificationChannel } from "@prisma/client";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";

const ALL_EVENTS: NotificationEvent[] = [
  "MINT_SUCCESS",
  "MINT_FAILED",
  "SNIPE_SUCCESS",
  "SNIPE_FAILED",
  "COLLECTION_PHASE_CHANGE",
  "WALLET_LOW_BALANCE",
  "BOT_COMPETITION_DETECTED",
  "SWEEP_DETECTED",
];

class UpsertNotificationConfigDto {
  @IsOptional()
  @IsObject()
  discordJson?: { webhookUrl: string };

  @IsOptional()
  @IsObject()
  smsJson?: { accountSid: string; authToken: string; from: string; to: string };

  @IsOptional()
  @IsObject()
  webhookJson?: { url: string; secret?: string };

  @IsOptional()
  @IsObject()
  telegramJson?: { botToken: string; chatId: string };

  @IsArray()
  @IsIn(ALL_EVENTS, { each: true })
  events!: NotificationEvent[];

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async sendNotification(
    userId: string,
    event: NotificationEvent,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const cfg = await this.prisma.notificationConfig.findUnique({ where: { userId } });
    if (!cfg || !cfg.enabled) return;
    if (!cfg.events.includes(event)) return;

    const discord = cfg.discordJson as { webhookUrl?: string } | null;
    const sms = cfg.smsJson as { accountSid?: string; authToken?: string; from?: string; to?: string } | null;
    const webhook = cfg.webhookJson as NotificationWebhookConfig | null;
    const telegram = webhook?.telegram ?? null;

    const jobs: Promise<void>[] = [];

    if (discord?.webhookUrl) {
      jobs.push(this.sendDiscord(cfg.id, event, discord.webhookUrl, payload));
    }
    if (sms?.accountSid && sms.authToken && sms.from && sms.to) {
      jobs.push(this.sendSms(cfg.id, event, sms as Required<typeof sms>, payload));
    }
    if (webhook?.url) {
      jobs.push(this.sendWebhook(cfg.id, event, webhook.url, webhook.secret, payload));
    }
    if (telegram?.botToken && telegram.chatId) {
      jobs.push(this.sendTelegram(cfg.id, event, telegram.botToken, telegram.chatId, payload));
    }

    await Promise.allSettled(jobs);
  }

  private async sendDiscord(
    configId: string,
    event: NotificationEvent,
    webhookUrl: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const color = event.includes("SUCCESS") ? 0x22c55e : event.includes("FAILED") ? 0xef4444 : 0x3b82f6;
    const body = {
      embeds: [
        {
          title: `[Astryn] ${event.replace(/_/g, " ")}`,
          color,
          fields: Object.entries(payload).slice(0, 6).map(([name, value]) => ({
            name,
            value: String(value).slice(0, 256),
            inline: true,
          })),
          timestamp: new Date().toISOString(),
        },
      ],
    };

    let success = false;
    let error: string | undefined;

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      success = res.ok;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    await this.prisma.notificationLog.create({
      data: { configId, channel: "DISCORD", event, payload: payload as Prisma.InputJsonValue, success, error },
    });
  }

  private async sendSms(
    configId: string,
    event: NotificationEvent,
    sms: { accountSid: string; authToken: string; from: string; to: string },
    payload: Record<string, unknown>,
  ): Promise<void> {
    const message = `[Astryn] ${event.replace(/_/g, " ")}: ${JSON.stringify(payload).slice(0, 140)}`;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sms.accountSid}/Messages.json`;
    const creds = Buffer.from(`${sms.accountSid}:${sms.authToken}`).toString("base64");

    let success = false;
    let error: string | undefined;

    try {
      const form = new URLSearchParams({ From: sms.from, To: sms.to, Body: message });
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      success = res.ok;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        error = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    await this.prisma.notificationLog.create({
      data: { configId, channel: "SMS", event, payload: payload as Prisma.InputJsonValue, success, error },
    });
  }

  private async sendWebhook(
    configId: string,
    event: NotificationEvent,
    url: string,
    secret: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const body = JSON.stringify({ event, payload, sentAt: new Date().toISOString() });
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (secret) {
      const sig = createHmac("sha256", secret).update(body).digest("hex");
      headers["X-Astryn-Signature"] = `sha256=${sig}`;
    }

    let success = false;
    let error: string | undefined;

    try {
      const res = await fetch(url, { method: "POST", headers, body });
      success = res.ok;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    await this.prisma.notificationLog.create({
      data: { configId, channel: "WEBHOOK" as NotificationChannel, event, payload: JSON.parse(body) as Prisma.InputJsonValue, success, error },
    });
  }

  private async sendTelegram(
    configId: string,
    event: NotificationEvent,
    botToken: string,
    chatId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const text = formatTelegramMessage(event, payload);
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    let success = false;
    let error: string | undefined;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          disable_web_page_preview: true,
        }),
      });
      success = res.ok;
      if (!res.ok) {
        const details = await res.text().catch(() => "");
        error = `HTTP ${res.status}: ${details.slice(0, 200)}`;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    await this.prisma.notificationLog.create({
      data: {
        configId,
        channel: "WEBHOOK" as NotificationChannel,
        event,
        payload: { notificationRoute: "TELEGRAM", ...payload } as Prisma.InputJsonValue,
        success,
        error
      },
    });
  }
}

@Controller("notifications")
@UseGuards(AuthGuard)
class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Get("config")
  async getConfig(@CurrentUser() user: CurrentUserType) {
    const cfg = await this.prisma.notificationConfig.findUnique({ where: { userId: user.id } });
    if (!cfg) {
      return { userId: user.id, events: [], enabled: false, discordJson: null, smsJson: null, webhookJson: null, telegramJson: null };
    }

    const webhook = cfg.webhookJson as NotificationWebhookConfig | null;
    return {
      ...cfg,
      webhookJson: compactWebhookConfig(webhook),
      telegramJson: webhook?.telegram ?? null
    };
  }

  @Put("config")
  async upsertConfig(@CurrentUser() user: CurrentUserType, @Body() body: UpsertNotificationConfigDto) {
    const webhookJson = mergeWebhookConfig(body.webhookJson, body.telegramJson);

    return this.prisma.notificationConfig.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        events: body.events,
        enabled: body.enabled ?? true,
        discordJson: body.discordJson ?? undefined,
        smsJson: body.smsJson ?? undefined,
        webhookJson,
      },
      update: {
        events: body.events,
        enabled: body.enabled ?? true,
        discordJson: body.discordJson ?? undefined,
        smsJson: body.smsJson ?? undefined,
        webhookJson,
      },
    });
  }

  @Get("logs")
  async getLogs(
    @CurrentUser() user: CurrentUserType,
    @Query("limit") limit?: string,
  ) {
    const cfg = await this.prisma.notificationConfig.findUnique({ where: { userId: user.id } });
    if (!cfg) return [];

    const logs = await this.prisma.notificationLog.findMany({
      where: { configId: cfg.id },
      orderBy: { sentAt: "desc" },
      take: limit ? Math.min(Number(limit), 200) : 50,
    });

    return logs.map((log) => {
      const payload = log.payload as { notificationRoute?: string } | null;
      return payload?.notificationRoute === "TELEGRAM" ? { ...log, channel: "TELEGRAM" } : log;
    });
  }
}

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

function formatTelegramMessage(event: NotificationEvent, payload: Record<string, unknown>) {
  const lines = [`[Astryn] ${event.replace(/_/g, " ")}`];
  for (const [key, value] of Object.entries(payload).slice(0, 8)) {
    lines.push(`${key}: ${String(value).slice(0, 180)}`);
  }
  return lines.join("\n").slice(0, 4000);
}

interface NotificationWebhookConfig {
  url?: string;
  secret?: string;
  telegram?: { botToken?: string; chatId?: string };
}

function compactWebhookConfig(webhook: NotificationWebhookConfig | null) {
  if (!webhook?.url) return null;
  return { url: webhook.url, secret: webhook.secret };
}

function mergeWebhookConfig(
  webhook?: { url: string; secret?: string },
  telegram?: { botToken: string; chatId: string },
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const value: NotificationWebhookConfig = {};

  if (webhook?.url) {
    value.url = webhook.url;
    if (webhook.secret) value.secret = webhook.secret;
  }

  if (telegram?.botToken && telegram.chatId) {
    value.telegram = { botToken: telegram.botToken, chatId: telegram.chatId };
  }

  return Object.keys(value).length > 0 ? value as Prisma.InputJsonValue : Prisma.JsonNull;
}
