import pino, { type DestinationStream, type LoggerOptions } from "pino";

export const REDACT_PATHS = [
  "privateKey",
  "*.privateKey",
  "encryptedPrivateKey",
  "*.encryptedPrivateKey",
  "password",
  "*.password",
  "currentPassword",
  "newPassword",
  "token",
  "*.token",
  "access_token",
  "*.access_token",
  "authorization",
  "Authorization",
  "headers.authorization",
  "headers.Authorization",
  "apiKey",
  "*.apiKey",
  "authToken",
  "*.authToken",
  "secret",
  "*.secret",
  "DATABASE_URL",
  "DIRECT_URL",
  "REDIS_URL",
  "JWT_SECRET",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ENCRYPTION_MASTER_KEY",
  "OPENSEA_API_KEY",
  "ONEINCH_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "DISCORD_WEBHOOK_URL",
  "TELEGRAM_BOT_TOKEN",
  "FLASHBOTS_AUTH_KEY",
] as const;

export function createLoggerOptions(): LoggerOptions {
  return {
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: [...REDACT_PATHS],
      censor: "[redacted]",
    },
    base: {
      service: process.env.SERVICE_NAME ?? "mint-copilot",
    },
  };
}

export function createAppLogger(destination?: DestinationStream) {
  const options = createLoggerOptions();
  return destination ? pino(options, destination) : pino(options);
}

export const logger = createAppLogger();

export type AppLogger = typeof logger;
