-- CreateTable
CREATE TABLE "DirectMintTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "chain" "Network" NOT NULL,
    "functionName" TEXT NOT NULL,
    "functionAbi" JSONB NOT NULL,
    "callArgs" JSONB NOT NULL,
    "valueWei" TEXT NOT NULL DEFAULT '0',
    "status" "MintTaskStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "gasSettingsJson" JSONB NOT NULL,
    "mintQuantity" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectMintTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectMintTaskWallet" (
    "id" TEXT NOT NULL,
    "directMintTaskId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "mintQuantity" INTEGER NOT NULL DEFAULT 1,
    "txHash" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DirectMintTaskWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectMintLog" (
    "id" TEXT NOT NULL,
    "directMintTaskId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectMintLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DirectMintTask_userId_status_idx" ON "DirectMintTask"("userId", "status");
CREATE INDEX "DirectMintTask_contractAddress_idx" ON "DirectMintTask"("contractAddress");
CREATE UNIQUE INDEX "DirectMintTaskWallet_directMintTaskId_walletId_key" ON "DirectMintTaskWallet"("directMintTaskId", "walletId");
CREATE INDEX "DirectMintLog_directMintTaskId_createdAt_idx" ON "DirectMintLog"("directMintTaskId", "createdAt");

-- AddForeignKey
ALTER TABLE "DirectMintTask" ADD CONSTRAINT "DirectMintTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectMintTaskWallet" ADD CONSTRAINT "DirectMintTaskWallet_directMintTaskId_fkey" FOREIGN KEY ("directMintTaskId") REFERENCES "DirectMintTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectMintTaskWallet" ADD CONSTRAINT "DirectMintTaskWallet_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectMintLog" ADD CONSTRAINT "DirectMintLog_directMintTaskId_fkey" FOREIGN KEY ("directMintTaskId") REFERENCES "DirectMintTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
