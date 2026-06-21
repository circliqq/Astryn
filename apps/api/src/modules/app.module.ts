import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerModule } from "@nestjs/throttler";
import { AdminModule } from "./domains/admin.module.js";
import { BotWarfareModule } from "./domains/bot-warfare.module.js";
import { MintAlertsModule } from "./domains/mint-alerts.module.js";
import { BundlerModule } from "./domains/bundler.module.js";
import { CollectionWatchModule } from "./domains/collection-watch.module.js";
import { ConsolidationModule } from "./domains/consolidation.module.js";
import { DistributorModule } from "./domains/distributor.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { CollectionsModule } from "./domains/collections.module.js";
import { FundingModule } from "./domains/funding.module.js";
import { GasModule } from "./domains/gas.module.js";
import { HealthModule } from "./domains/health.module.js";
import { LogsModule } from "./domains/logs.module.js";
import { MintTasksModule } from "./domains/mint-tasks.module.js";
import { NotificationsModule } from "./domains/notifications.module.js";
import { OpenSeaModule } from "./domains/opensea.module.js";
import { PortfolioModule } from "./domains/portfolio.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { ReadinessModule } from "./domains/readiness.module.js";
import { ReportsModule } from "./domains/reports.module.js";
import { RpcModule } from "./domains/rpc.module.js";
import { SecurityAuditModule } from "./domains/security-audit.module.js";
import { SimulationModule } from "./domains/simulation.module.js";
import { SniperModule } from "./domains/sniper.module.js";
import { SwapModule } from "./domains/swap.module.js";
import { SupportModule } from "./domains/support.module.js";
import { SweepAlertModule } from "./domains/sweep-alert.module.js";
import { TransactionsModule } from "./domains/transactions.module.js";
import { UsersModule } from "./domains/users.module.js";
import { WalletHealthModule } from "./domains/wallet-health.module.js";
import { WalletsModule } from "./domains/wallets.module.js";
import { WhitelistCheckerModule } from "./domains/whitelist-checker.module.js";
import { EventsModule } from "./events/events.module.js";
import { DirectMintModule } from "./domains/direct-mint.module.js";
import { BundleMintModule } from "./domains/bundle-mint.module.js";
import { DropScannerModule } from "./domains/drop-scanner.module.js";
import { TraderTrackerModule } from "./domains/trader-tracker.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    HealthModule,
    EventsModule,
    AuthModule,
    UsersModule,
    WalletsModule,
    WhitelistCheckerModule,
    CollectionsModule,
    OpenSeaModule,
    WalletHealthModule,
    FundingModule,
    SimulationModule,
    ReadinessModule,
    MintTasksModule,
    TransactionsModule,
    LogsModule,
    RpcModule,
    GasModule,
    ReportsModule,
    AdminModule,
    SecurityAuditModule,
    DistributorModule,
    ConsolidationModule,
    BundlerModule,
    SniperModule,
    NotificationsModule,
    PortfolioModule,
    CollectionWatchModule,
    BotWarfareModule,
    SwapModule,
    SweepAlertModule,
    MintAlertsModule,
    SupportModule,
    DirectMintModule,
    BundleMintModule,
    DropScannerModule,
    TraderTrackerModule,
  ]
})
export class AppModule {}
