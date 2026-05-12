import { Controller, Get, Header, Module, Param, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller("reports")
@UseGuards(AuthGuard)
class ReportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(":taskId")
  async get(@Param("taskId") taskId: string) {
    const existing = await this.prisma.postMintReport.findUnique({ where: { mintTaskId: taskId } });
    if (existing) return existing;

    const task = await this.prisma.mintTask.findUniqueOrThrow({
      where: { id: taskId },
      include: { wallets: true, transactions: true }
    });
    return buildReportSummary(task);
  }

  @Get(":taskId/export-csv")
  @Header("content-type", "text/csv")
  async csv(@Param("taskId") taskId: string) {
    const task = await this.prisma.mintTask.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        wallets: { include: { wallet: true } },
        transactions: { include: { wallet: true }, orderBy: { createdAt: "asc" } }
      }
    });
    const txByWalletId = new Map(task.transactions.map((tx) => [tx.walletId, tx]));
    const rows =
      task.wallets.length > 0
        ? task.wallets.map((taskWallet) => {
            const tx = txByWalletId.get(taskWallet.walletId);
            return [
              taskWallet.wallet.name,
              taskWallet.wallet.address,
              tx?.status ?? taskWallet.status,
              tx?.txHash ?? "",
              tx?.gasFeeWei ?? "",
              tx?.errorMessage ?? tx?.errorCode ?? taskWallet.errorCode ?? ""
            ];
          })
        : task.transactions.map((tx) => [
            tx.wallet.name,
            tx.wallet.address,
            tx.status,
            tx.txHash ?? "",
            tx.gasFeeWei ?? "",
            tx.errorMessage ?? tx.errorCode ?? ""
          ]);

    return [
      "wallet,address,status,txHash,gasFeeWei,error",
      ...rows.map((row) => row.map((value) => `"${String(value).replaceAll("\"", "\"\"")}"`).join(","))
    ].join("\n");
  }
}

@Module({ controllers: [ReportsController] })
export class ReportsModule {}

function buildReportSummary(task: {
  id: string;
  wallets: Array<{ status: string; errorCode: string | null }>;
  transactions: Array<{
    status: string;
    txHash: string | null;
    gasFeeWei: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}) {
  const confirmed = task.transactions.filter((tx) => tx.status === "CONFIRMED");
  const failedTxs = task.transactions.filter((tx) => tx.status === "FAILED");
  const failedWallets = task.wallets.filter((wallet) => wallet.status === "failed");
  const totalGas = task.transactions.reduce((sum, tx) => sum + BigInt(tx.gasFeeWei ?? "0"), 0n);
  const confirmationTimes = confirmed
    .map((tx) => tx.updatedAt.getTime() - tx.createdAt.getTime())
    .filter((ms) => ms > 0);

  return {
    mintTaskId: task.id,
    totalWallets: task.wallets.length || task.transactions.length,
    successfulMints: confirmed.length,
    failedMints: Math.max(failedTxs.length, failedWallets.length),
    totalGasSpentWei: totalGas.toString(),
    avgConfirmationTimeSec:
      confirmationTimes.length > 0
        ? confirmationTimes.reduce((sum, ms) => sum + ms, 0) / confirmationTimes.length / 1000
        : 0,
    failureReasonsJson: failedWallets.map((wallet) => wallet.errorCode ?? "Unknown"),
    txHashesJson: confirmed.map((tx) => tx.txHash).filter(Boolean)
  };
}
