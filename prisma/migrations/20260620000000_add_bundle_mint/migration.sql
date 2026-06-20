-- CreateEnum
CREATE TYPE "BundleMode" AS ENUM ('MULTI_WALLET', 'SINGLE_WALLET_MULTI_TX');

-- CreateEnum
CREATE TYPE "BundleMintKind" AS ENUM ('SEADROP', 'CUSTOM');

-- CreateTable
CREATE TABLE "BundleMintTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "chain" "Network" NOT NULL,
    "kind" "BundleMintKind" NOT NULL DEFAULT 'SEADROP',
    "mode" "BundleMode" NOT NULL DEFAULT 'MULTI_WALLET',
    "functionName" TEXT,
    "functionAbi" JSONB,
    "callArgs" JSONB,
    "mintPriceWei" TEXT NOT NULL DEFAULT '0',
    "valueWei" TEXT NOT NULL DEFAULT '0',
    "status" "MintTaskStatus" NOT NULL DEFAULT 'DRAFT',
    "mintQuantity" INTEGER NOT NULL DEFAULT 1,
    "txPerWallet" INTEGER NOT NULL DEFAULT 1,
    "targetBlock" TEXT,
    "blockOffset" INTEGER NOT NULL DEFAULT 1,
    "maxBlockRetries" INTEGER NOT NULL DEFAULT 3,
    "bundleHash" TEXT,
    "includedBlock" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "gasSettingsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BundleMintTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleMintTaskWallet" (
    "id" TEXT NOT NULL,
    "bundleMintTaskId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "txHash" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BundleMintTaskWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleMintLog" (
    "id" TEXT NOT NULL,
    "bundleMintTaskId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BundleMintLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BundleMintTask_userId_status_idx" ON "BundleMintTask"("userId", "status");

-- CreateIndex
CREATE INDEX "BundleMintTask_contractAddress_idx" ON "BundleMintTask"("contractAddress");

-- CreateIndex
CREATE UNIQUE INDEX "BundleMintTaskWallet_bundleMintTaskId_walletId_key" ON "BundleMintTaskWallet"("bundleMintTaskId", "walletId");

-- CreateIndex
CREATE INDEX "BundleMintLog_bundleMintTaskId_createdAt_idx" ON "BundleMintLog"("bundleMintTaskId", "createdAt");

-- AddForeignKey
ALTER TABLE "BundleMintTask" ADD CONSTRAINT "BundleMintTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleMintTaskWallet" ADD CONSTRAINT "BundleMintTaskWallet_bundleMintTaskId_fkey" FOREIGN KEY ("bundleMintTaskId") REFERENCES "BundleMintTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleMintTaskWallet" ADD CONSTRAINT "BundleMintTaskWallet_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleMintLog" ADD CONSTRAINT "BundleMintLog_bundleMintTaskId_fkey" FOREIGN KEY ("bundleMintTaskId") REFERENCES "BundleMintTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
