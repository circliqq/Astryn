-- ============================================================
-- Idempotent migration — safe to run even after a db push that
-- already created some of these objects.
-- ============================================================

-- Add mintQuantity to MintTask (missing from previous migration)
ALTER TABLE "MintTask" ADD COLUMN IF NOT EXISTS "mintQuantity" INTEGER NOT NULL DEFAULT 1;

-- ── Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "NotificationChannel" AS ENUM ('DISCORD', 'SMS', 'WEBHOOK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationEvent" AS ENUM (
    'MINT_SUCCESS', 'MINT_FAILED', 'SNIPE_SUCCESS', 'SNIPE_FAILED',
    'COLLECTION_PHASE_CHANGE', 'WALLET_LOW_BALANCE',
    'BOT_COMPETITION_DETECTED', 'SWEEP_DETECTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add SWEEP_DETECTED to the enum if it was created without it
DO $$ BEGIN
  ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'SWEEP_DETECTED';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BundleStatus" AS ENUM ('PENDING', 'SUBMITTED', 'INCLUDED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SniperTaskType" AS ENUM ('FAT_FINGER', 'RARITY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SniperTaskStatus" AS ENUM ('WATCHING', 'TRIGGERED', 'EXECUTING', 'COMPLETED', 'FAILED', 'PAUSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SwapStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── BotCompetitionLog ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "BotCompetitionLog" (
    "id"                TEXT NOT NULL,
    "mintTaskId"        TEXT,
    "network"           "Network" NOT NULL,
    "collectionSlug"    TEXT,
    "competitorCount"   INTEGER NOT NULL DEFAULT 0,
    "detectedGasWei"    TEXT,
    "recommendedGasWei" TEXT,
    "gasAdjusted"       BOOLEAN NOT NULL DEFAULT false,
    "detectedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotCompetitionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BotCompetitionLog_mintTaskId_idx" ON "BotCompetitionLog"("mintTaskId");

DO $$ BEGIN
  ALTER TABLE "BotCompetitionLog"
    ADD CONSTRAINT "BotCompetitionLog_mintTaskId_fkey"
    FOREIGN KEY ("mintTaskId") REFERENCES "MintTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── TxBundle ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "TxBundle" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "mintTaskId"   TEXT,
    "network"      "Network" NOT NULL,
    "status"       "BundleStatus" NOT NULL DEFAULT 'PENDING',
    "bundleHash"   TEXT,
    "txCount"      INTEGER NOT NULL DEFAULT 0,
    "targetBlock"  TEXT,
    "gasRefundWei" TEXT,
    "errorMessage" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TxBundle_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TxBundle_userId_status_idx" ON "TxBundle"("userId", "status");

DO $$ BEGIN
  ALTER TABLE "TxBundle" ADD CONSTRAINT "TxBundle_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TxBundle" ADD CONSTRAINT "TxBundle_mintTaskId_fkey"
    FOREIGN KEY ("mintTaskId") REFERENCES "MintTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── SniperTask ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "SniperTask" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "walletId"        TEXT NOT NULL,
    "type"            "SniperTaskType" NOT NULL,
    "status"          "SniperTaskStatus" NOT NULL DEFAULT 'WATCHING',
    "collectionSlug"  TEXT,
    "contractAddress" TEXT,
    "network"         "Network" NOT NULL,
    "maxPriceWei"     TEXT NOT NULL,
    "floorThreshold"  DOUBLE PRECISION,
    "minRarityScore"  DOUBLE PRECISION,
    "gasSettingsJson" JSONB,
    "triggeredAt"     TIMESTAMP(3),
    "completedAt"     TIMESTAMP(3),
    "txHash"          TEXT,
    "errorMessage"    TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SniperTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SniperTask_userId_status_idx" ON "SniperTask"("userId", "status");

DO $$ BEGIN
  ALTER TABLE "SniperTask" ADD CONSTRAINT "SniperTask_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SniperTask" ADD CONSTRAINT "SniperTask_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── NotificationConfig ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "NotificationConfig" (
    "id"          TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "discordJson" JSONB,
    "smsJson"     JSONB,
    "webhookJson" JSONB,
    "events"      "NotificationEvent"[],
    "enabled"     BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationConfig_userId_key" ON "NotificationConfig"("userId");

DO $$ BEGIN
  ALTER TABLE "NotificationConfig" ADD CONSTRAINT "NotificationConfig_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── NotificationLog ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "NotificationLog" (
    "id"       TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "channel"  "NotificationChannel" NOT NULL,
    "event"    "NotificationEvent" NOT NULL,
    "payload"  JSONB NOT NULL,
    "success"  BOOLEAN NOT NULL,
    "error"    TEXT,
    "sentAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "NotificationLog_configId_sentAt_idx" ON "NotificationLog"("configId", "sentAt");

DO $$ BEGIN
  ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_configId_fkey"
    FOREIGN KEY ("configId") REFERENCES "NotificationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── CollectionWatch ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "CollectionWatch" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "collectionSlug" TEXT NOT NULL,
    "network"        "Network" NOT NULL,
    "alertOnPhase"   BOOLEAN NOT NULL DEFAULT true,
    "alertOnSupply"  BOOLEAN NOT NULL DEFAULT true,
    "alertOnPrice"   BOOLEAN NOT NULL DEFAULT true,
    "enabled"        BOOLEAN NOT NULL DEFAULT true,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollectionWatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CollectionWatch_userId_collectionSlug_network_key"
    ON "CollectionWatch"("userId", "collectionSlug", "network");

CREATE INDEX IF NOT EXISTS "CollectionWatch_userId_idx" ON "CollectionWatch"("userId");

DO $$ BEGIN
  ALTER TABLE "CollectionWatch" ADD CONSTRAINT "CollectionWatch_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── PortfolioItem ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "PortfolioItem" (
    "id"               TEXT NOT NULL,
    "userId"           TEXT NOT NULL,
    "network"          "Network" NOT NULL,
    "walletAddress"    TEXT NOT NULL,
    "contractAddress"  TEXT NOT NULL,
    "tokenId"          TEXT NOT NULL,
    "collectionSlug"   TEXT,
    "collectionName"   TEXT,
    "acquiredPriceWei" TEXT NOT NULL,
    "currentPriceWei"  TEXT,
    "pnlWei"           TEXT,
    "acquiredAt"       TIMESTAMP(3) NOT NULL,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortfolioItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PortfolioItem_userId_network_contractAddress_tokenId_key"
    ON "PortfolioItem"("userId", "network", "contractAddress", "tokenId");

CREATE INDEX IF NOT EXISTS "PortfolioItem_userId_network_idx" ON "PortfolioItem"("userId", "network");

DO $$ BEGIN
  ALTER TABLE "PortfolioItem" ADD CONSTRAINT "PortfolioItem_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── SwapOrder ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "SwapOrder" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "walletId"     TEXT NOT NULL,
    "network"      "Network" NOT NULL,
    "fromToken"    TEXT NOT NULL,
    "toToken"      TEXT NOT NULL,
    "amountInWei"  TEXT NOT NULL,
    "amountOutWei" TEXT,
    "slippageBps"  INTEGER NOT NULL DEFAULT 50,
    "status"       "SwapStatus" NOT NULL DEFAULT 'PENDING',
    "txHash"       TEXT,
    "errorMessage" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"  TIMESTAMP(3),
    CONSTRAINT "SwapOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SwapOrder_userId_status_idx" ON "SwapOrder"("userId", "status");

DO $$ BEGIN
  ALTER TABLE "SwapOrder" ADD CONSTRAINT "SwapOrder_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SwapOrder" ADD CONSTRAINT "SwapOrder_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── SweepAlert ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "SweepAlert" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "collectionSlug"  TEXT NOT NULL,
    "network"         "Network" NOT NULL,
    "minItems"        INTEGER NOT NULL DEFAULT 5,
    "windowSeconds"   INTEGER NOT NULL DEFAULT 60,
    "enabled"         BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SweepAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SweepAlert_userId_collectionSlug_network_key"
    ON "SweepAlert"("userId", "collectionSlug", "network");

CREATE INDEX IF NOT EXISTS "SweepAlert_userId_idx" ON "SweepAlert"("userId");
CREATE INDEX IF NOT EXISTS "SweepAlert_enabled_idx" ON "SweepAlert"("enabled");

DO $$ BEGIN
  ALTER TABLE "SweepAlert" ADD CONSTRAINT "SweepAlert_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── SweepDetectionLog ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "SweepDetectionLog" (
    "id"             TEXT NOT NULL,
    "sweepAlertId"   TEXT NOT NULL,
    "collectionSlug" TEXT NOT NULL,
    "network"        "Network" NOT NULL,
    "itemCount"      INTEGER NOT NULL,
    "windowSeconds"  INTEGER NOT NULL,
    "detectedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "salePricesJson" JSONB,
    CONSTRAINT "SweepDetectionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SweepDetectionLog_sweepAlertId_detectedAt_idx"
    ON "SweepDetectionLog"("sweepAlertId", "detectedAt");

DO $$ BEGIN
  ALTER TABLE "SweepDetectionLog" ADD CONSTRAINT "SweepDetectionLog_sweepAlertId_fkey"
    FOREIGN KEY ("sweepAlertId") REFERENCES "SweepAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
