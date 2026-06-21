-- CreateEnum
CREATE TYPE "DropRisk" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "ScannedDrop" (
    "id" TEXT NOT NULL,
    "chain" "Network" NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "slug" TEXT,
    "name" TEXT,
    "imageUrl" TEXT,
    "source" TEXT NOT NULL DEFAULT 'onchain',
    "publicStartTime" TIMESTAMP(3),
    "publicEndTime" TIMESTAMP(3),
    "publicPriceWei" TEXT,
    "maxPerWallet" INTEGER,
    "supply" INTEGER,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "hasTwitter" BOOLEAN NOT NULL DEFAULT false,
    "hasDiscord" BOOLEAN NOT NULL DEFAULT false,
    "hasWebsite" BOOLEAN NOT NULL DEFAULT false,
    "riskScore" INTEGER NOT NULL DEFAULT 50,
    "riskLevel" "DropRisk" NOT NULL DEFAULT 'MEDIUM',
    "riskFlags" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScannedDrop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScannerCursor" (
    "chain" "Network" NOT NULL,
    "lastBlock" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScannerCursor_pkey" PRIMARY KEY ("chain")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScannedDrop_contractAddress_chain_key" ON "ScannedDrop"("contractAddress", "chain");

-- CreateIndex
CREATE INDEX "ScannedDrop_status_publicStartTime_idx" ON "ScannedDrop"("status", "publicStartTime");

-- CreateIndex
CREATE INDEX "ScannedDrop_riskScore_idx" ON "ScannedDrop"("riskScore");
