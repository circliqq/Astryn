-- CreateEnum
CREATE TYPE "Network" AS ENUM ('BASE', 'ETHEREUM');

-- CreateEnum
CREATE TYPE "MintPhaseType" AS ENUM ('PUBLIC', 'ALLOWLIST', 'GTD', 'FCFS');

-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('READY', 'LOW_BALANCE', 'NEED_FUNDING', 'NOT_ELIGIBLE', 'NONCE_ISSUE');

-- CreateEnum
CREATE TYPE "MintTaskStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('WAITING', 'SIGNED', 'BROADCAST', 'PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "RpcStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'OFFLINE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "supabaseUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "network" "Network" NOT NULL,
    "status" "WalletStatus" NOT NULL DEFAULT 'READY',
    "encryptedPrivateKey" TEXT NOT NULL,
    "encryptionSalt" TEXT NOT NULL,
    "encryptionIv" TEXT NOT NULL,
    "encryptionAuthTag" TEXT NOT NULL,
    "encryptionVersion" TEXT NOT NULL,
    "lastBalanceWei" TEXT,
    "lastNonce" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletGroup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletGroupMember" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "walletGroupId" TEXT NOT NULL,

    CONSTRAINT "WalletGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "chain" "Network" NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "mintPriceWei" TEXT NOT NULL,
    "supply" INTEGER,
    "maxMint" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MintPhase" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "phaseType" "MintPhaseType" NOT NULL,
    "priceWei" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "maxMint" INTEGER,
    "allowlistRoot" TEXT,

    CONSTRAINT "MintPhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MintTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "phaseType" "MintPhaseType" NOT NULL,
    "status" "MintTaskStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "gasSettingsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MintTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MintTaskWallet" (
    "id" TEXT NOT NULL,
    "mintTaskId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,

    CONSTRAINT "MintTaskWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "mintTaskId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "network" "Network" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'WAITING',
    "txHash" TEXT,
    "nonce" INTEGER,
    "gasUsedWei" TEXT,
    "gasFeeWei" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskLog" (
    "id" TEXT NOT NULL,
    "mintTaskId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "contextJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RpcEndpoint" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "network" "Network" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RpcEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RpcHealthLog" (
    "id" TEXT NOT NULL,
    "rpcEndpointId" TEXT NOT NULL,
    "status" "RpcStatus" NOT NULL,
    "latencyMs" INTEGER,
    "blockNumber" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RpcHealthLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GasSnapshot" (
    "id" TEXT NOT NULL,
    "network" "Network" NOT NULL,
    "baseFeeWei" TEXT NOT NULL,
    "priorityFeeWei" TEXT NOT NULL,
    "maxFeeWei" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GasSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletHealthCheck" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "network" "Network" NOT NULL,
    "funded" BOOLEAN NOT NULL,
    "nonceClean" BOOLEAN NOT NULL,
    "balanceWei" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL,
    "warningsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletHealthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationResult" (
    "id" TEXT NOT NULL,
    "mintTaskId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "estimatedGasWei" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadinessScore" (
    "id" TEXT NOT NULL,
    "mintTaskId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "breakdownJson" JSONB NOT NULL,
    "blockersJson" JSONB NOT NULL,
    "warningsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadinessScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "network" "Network" NOT NULL,
    "totalRequiredWei" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingPlanItem" (
    "id" TEXT NOT NULL,
    "fundingPlanId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "requiredWei" TEXT NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "FundingPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostMintReport" (
    "id" TEXT NOT NULL,
    "mintTaskId" TEXT NOT NULL,
    "totalWallets" INTEGER NOT NULL,
    "successfulMints" INTEGER NOT NULL,
    "failedMints" INTEGER NOT NULL,
    "totalGasSpentWei" TEXT NOT NULL,
    "avgConfirmationTimeSec" DOUBLE PRECISION NOT NULL,
    "failureReasonsJson" JSONB NOT NULL,
    "txHashesJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostMintReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_supabaseUserId_key" ON "User"("supabaseUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Wallet_userId_status_idx" ON "Wallet"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_address_network_key" ON "Wallet"("userId", "address", "network");

-- CreateIndex
CREATE UNIQUE INDEX "WalletGroupMember_walletId_walletGroupId_key" ON "WalletGroupMember"("walletId", "walletGroupId");

-- CreateIndex
CREATE INDEX "Collection_contractAddress_chain_idx" ON "Collection"("contractAddress", "chain");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_slug_chain_key" ON "Collection"("slug", "chain");

-- CreateIndex
CREATE UNIQUE INDEX "MintTaskWallet_mintTaskId_walletId_key" ON "MintTaskWallet"("mintTaskId", "walletId");

-- CreateIndex
CREATE INDEX "TaskLog_mintTaskId_createdAt_idx" ON "TaskLog"("mintTaskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PostMintReport_mintTaskId_key" ON "PostMintReport"("mintTaskId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletGroup" ADD CONSTRAINT "WalletGroup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletGroupMember" ADD CONSTRAINT "WalletGroupMember_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletGroupMember" ADD CONSTRAINT "WalletGroupMember_walletGroupId_fkey" FOREIGN KEY ("walletGroupId") REFERENCES "WalletGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MintPhase" ADD CONSTRAINT "MintPhase_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MintTask" ADD CONSTRAINT "MintTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MintTask" ADD CONSTRAINT "MintTask_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MintTaskWallet" ADD CONSTRAINT "MintTaskWallet_mintTaskId_fkey" FOREIGN KEY ("mintTaskId") REFERENCES "MintTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MintTaskWallet" ADD CONSTRAINT "MintTaskWallet_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_mintTaskId_fkey" FOREIGN KEY ("mintTaskId") REFERENCES "MintTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLog" ADD CONSTRAINT "TaskLog_mintTaskId_fkey" FOREIGN KEY ("mintTaskId") REFERENCES "MintTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RpcEndpoint" ADD CONSTRAINT "RpcEndpoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RpcHealthLog" ADD CONSTRAINT "RpcHealthLog_rpcEndpointId_fkey" FOREIGN KEY ("rpcEndpointId") REFERENCES "RpcEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletHealthCheck" ADD CONSTRAINT "WalletHealthCheck_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationResult" ADD CONSTRAINT "SimulationResult_mintTaskId_fkey" FOREIGN KEY ("mintTaskId") REFERENCES "MintTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationResult" ADD CONSTRAINT "SimulationResult_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessScore" ADD CONSTRAINT "ReadinessScore_mintTaskId_fkey" FOREIGN KEY ("mintTaskId") REFERENCES "MintTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessScore" ADD CONSTRAINT "ReadinessScore_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingPlan" ADD CONSTRAINT "FundingPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingPlanItem" ADD CONSTRAINT "FundingPlanItem_fundingPlanId_fkey" FOREIGN KEY ("fundingPlanId") REFERENCES "FundingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingPlanItem" ADD CONSTRAINT "FundingPlanItem_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMintReport" ADD CONSTRAINT "PostMintReport_mintTaskId_fkey" FOREIGN KEY ("mintTaskId") REFERENCES "MintTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityAuditLog" ADD CONSTRAINT "SecurityAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
