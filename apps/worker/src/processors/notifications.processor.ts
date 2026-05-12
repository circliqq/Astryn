import type { Job } from "bullmq";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";
import { logger } from "@mint-copilot/logger";
import type { NotificationEvent } from "@prisma/client";

interface NotificationJob {
  userId: string;
  event: NotificationEvent;
  payload: Record<string, unknown>;
}

function jsonPayload(payload: Record<string, unknown>): Prisma.InputJsonObject {
  return payload as Prisma.InputJsonObject;
}

export async function processNotification(job: Job<NotificationJob>, prisma: PrismaClient) {
  const { userId, event, payload } = job.data;

  const cfg = await prisma.notificationConfig.findUnique({ where: { userId } });
  if (!cfg || !cfg.enabled) return;
  if (!cfg.events.includes(event)) return;

  const discord = cfg.discordJson as { webhookUrl?: string } | null;
  const sms = cfg.smsJson as { accountSid?: string; authToken?: string; from?: string; to?: string } | null;
  const webhook = cfg.webhookJson as NotificationWebhookConfig | null;
  const telegram = webhook?.telegram ?? null;

  const jobs: Promise<void>[] = [];

  if (discord?.webhookUrl) {
    jobs.push(sendDiscord(prisma, cfg.id, event, discord.webhookUrl, payload));
  }

  if (sms?.accountSid && sms.authToken && sms.from && sms.to) {
    jobs.push(sendSms(prisma, cfg.id, event, sms as Required<NonNullable<typeof sms>>, payload));
  }

  if (webhook?.url) {
    jobs.push(sendWebhook(prisma, cfg.id, event, webhook.url, webhook.secret, payload));
  }

  if (telegram?.botToken && telegram.chatId) {
    jobs.push(sendTelegram(prisma, cfg.id, event, telegram.botToken, telegram.chatId, payload));
  }

  await Promise.allSettled(jobs);
  logger.info({ userId, event }, "notification processed");
}

async function sendDiscord(
  prisma: PrismaClient,
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

  await prisma.notificationLog.create({
    data: { configId, channel: "DISCORD", event, payload: jsonPayload(payload), success, error },
  });
}

async function sendSms(
  prisma: PrismaClient,
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
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  await prisma.notificationLog.create({
    data: { configId, channel: "SMS", event, payload: jsonPayload(payload), success, error },
  });
}

async function sendWebhook(
  prisma: PrismaClient,
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

  await prisma.notificationLog.create({
    data: {
      configId,
      channel: "WEBHOOK",
      event,
      payload: jsonPayload(JSON.parse(body) as Record<string, unknown>),
      success,
      error,
    },
  });
}

async function sendTelegram(
  prisma: PrismaClient,
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

  await prisma.notificationLog.create({
    data: {
      configId,
      channel: "WEBHOOK",
      event,
      payload: jsonPayload({ notificationRoute: "TELEGRAM", ...payload }),
      success,
      error
    },
  });
}

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
