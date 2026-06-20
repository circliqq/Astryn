-- CreateEnum
CREATE TYPE "ValuePayer" AS ENUM ('TX_SENDER', 'DELEGATED');

-- AlterTable
ALTER TABLE "BundleMintTask" ADD COLUMN "valuePayer" "ValuePayer" NOT NULL DEFAULT 'TX_SENDER';
ALTER TABLE "BundleMintTask" ADD COLUMN "startTimestampMs" TEXT;
