import type { Job } from "bullmq";
import type { PrismaClient } from "@prisma/client";

export async function processReport(job: Job<{ taskId: string }>, prisma: PrismaClient) {
  const task = await prisma.mintTask.findUniqueOrThrow({
    where: { id: job.data.taskId },
    include: { wallets: true, transactions: true }
  });
  const successful = task.transactions.filter((tx) => tx.status === "CONFIRMED");
  const failedTransactions = task.transactions.filter((tx) => tx.status === "FAILED");
  const failedWallets = task.wallets.filter((wallet) => wallet.status === "failed");
  const totalGas = task.transactions.reduce((sum, tx) => sum + BigInt(tx.gasFeeWei ?? "0"), 0n);
  const confirmationTimes = successful
    .map((tx) => tx.updatedAt.getTime() - tx.createdAt.getTime())
    .filter((ms) => ms > 0);
  const avgConfirmationTimeSec =
    confirmationTimes.length > 0
      ? confirmationTimes.reduce((sum, ms) => sum + ms, 0) / confirmationTimes.length / 1000
      : 0;
  const failedMints = Math.max(failedTransactions.length, failedWallets.length);
  const failureReasons = failedWallets.length > 0
    ? failedWallets.map((wallet) => wallet.errorCode ?? "Unknown")
    : failedTransactions.map((tx) => tx.errorMessage ?? tx.errorCode ?? "Unknown");
  const txHashes = successful.map((tx) => tx.txHash).filter(Boolean);

  return prisma.postMintReport.upsert({
    where: { mintTaskId: task.id },
    create: {
      mintTaskId: task.id,
      totalWallets: task.wallets.length,
      successfulMints: successful.length,
      failedMints,
      totalGasSpentWei: totalGas.toString(),
      avgConfirmationTimeSec,
      failureReasonsJson: failureReasons,
      txHashesJson: txHashes
    },
    update: {
      totalWallets: task.wallets.length,
      successfulMints: successful.length,
      failedMints,
      totalGasSpentWei: totalGas.toString(),
      avgConfirmationTimeSec,
      failureReasonsJson: failureReasons,
      txHashesJson: txHashes
    }
  });
}
