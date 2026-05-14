import { Controller, Get, Header, Module, Param, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OpenSeaClient } from "@mint-copilot/opensea";
import { AuthGuard } from "../auth/auth.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller("reports")
@UseGuards(AuthGuard)
class ReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

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

  @Get(":taskId/pnl")
  async getPnl(@Param("taskId") taskId: string) {
    const task = await this.prisma.mintTask.findUniqueOrThrow({
      where: { id: taskId },
      include: { collection: true, report: true, wallets: true, transactions: true },
    });

    const confirmed = task.transactions.filter((tx) => tx.status === "CONFIRMED");
    const successfulMints = task.report?.successfulMints ?? confirmed.length;
    const mintQuantity = task.mintQuantity;
    const mintPriceWei = BigInt(task.collection.mintPriceWei);
    const totalGasWei = BigInt(
      task.report?.totalGasSpentWei ??
      task.transactions.reduce((sum, tx) => sum + BigInt(tx.gasFeeWei ?? "0"), 0n).toString()
    );

    // Invested = (mint price × qty × successful wallets) + total gas
    const mintCostWei = mintPriceWei * BigInt(mintQuantity) * BigInt(successfulMints);
    const investedWei = mintCostWei + totalGasWei;
    const investedEth = Number(investedWei) / 1e18;
    const gasEth = Number(totalGasWei) / 1e18;
    const mintPriceEth = Number(mintPriceWei) / 1e18;

    // ETH/USD price via CoinGecko (free, no key)
    let ethUsdPrice = 0;
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
        { signal: AbortSignal.timeout(4_000) }
      );
      const data = (await res.json()) as { ethereum?: { usd?: number } };
      ethUsdPrice = data?.ethereum?.usd ?? 0;
    } catch { /* non-fatal */ }

    // Floor price via OpenSea
    let floorPriceEth = 0;
    let floorUnavailable = false;
    try {
      const client = new OpenSeaClient({
        apiKey: this.config.getOrThrow<string>("OPENSEA_API_KEY"),
      });
      const stats = await client.getCollectionStats(task.collection.slug);
      floorPriceEth = stats.floorPriceEth ? Number(stats.floorPriceEth) : 0;
    } catch {
      floorUnavailable = true;
    }

    const currentValueEth = floorPriceEth * mintQuantity * successfulMints;
    const pnlEth = currentValueEth - investedEth;
    const pnlPercent = investedEth > 0 ? (pnlEth / investedEth) * 100 : 0;

    return {
      investedEth: investedEth.toFixed(6),
      investedUsd: (investedEth * ethUsdPrice).toFixed(2),
      currentValueEth: currentValueEth.toFixed(6),
      currentValueUsd: (currentValueEth * ethUsdPrice).toFixed(2),
      pnlEth: pnlEth.toFixed(6),
      pnlUsd: (pnlEth * ethUsdPrice).toFixed(2),
      pnlPercent: Number(pnlPercent.toFixed(1)),
      floorPriceEth: floorPriceEth.toFixed(6),
      mintPriceEth: mintPriceEth.toFixed(6),
      gasEth: gasEth.toFixed(6),
      ethUsdPrice,
      mintQuantity,
      successfulMints,
      floorUnavailable,
    };
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

@Module({ controllers: [ReportsController], providers: [ConfigService] })
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
