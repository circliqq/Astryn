-- AlterEnum
ALTER TYPE "BundleMode" ADD VALUE 'EIP7702';

-- AlterTable
ALTER TABLE "BundleMintTask" ADD COLUMN "sponsorWalletId" TEXT;
ALTER TABLE "BundleMintTask" ADD COLUMN "executorAddress" TEXT;
