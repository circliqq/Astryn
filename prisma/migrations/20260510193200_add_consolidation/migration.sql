-- CreateTable
CREATE TABLE "ConsolidationRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'My Cold Wallet',
    "coldWallet" TEXT NOT NULL,
    "network" "Network" NOT NULL,
    "autoTrigger" BOOLEAN NOT NULL DEFAULT false,
    "sourceWalletIds" TEXT[],
    "contractAddresses" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsolidationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsolidationJob" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "triggeredBy" TEXT NOT NULL DEFAULT 'manual',
    "transferCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "transfersJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ConsolidationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsolidationRule_userId_idx" ON "ConsolidationRule"("userId");

-- CreateIndex
CREATE INDEX "ConsolidationJob_ruleId_createdAt_idx" ON "ConsolidationJob"("ruleId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConsolidationRule" ADD CONSTRAINT "ConsolidationRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsolidationJob" ADD CONSTRAINT "ConsolidationJob_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ConsolidationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
