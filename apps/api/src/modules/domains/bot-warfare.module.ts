import {
  Controller,
  Get,
  Injectable,
  Module,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createPublicClient, http } from "viem";
import { base, mainnet } from "viem/chains";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { EventsGateway } from "../events/events.gateway.js";
import { EventsModule } from "../events/events.module.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class BotWarfareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: EventsGateway,
  ) {}

  async detectCompetition(
    mintTaskId: string | null,
    network: "BASE" | "ETHEREUM",
    collectionSlug?: string,
  ): Promise<{ competitorCount: number; recommendedGasWei: string; gasAdjusted: boolean }> {
    const isBase = network === "BASE";
    const rpcUrl = this.config.get<string>(isBase ? "BASE_RPC_PRIMARY" : "ETH_RPC_PRIMARY");

    let detectedGasWei: string | undefined;
    let recommendedGasWei: string;
    let competitorCount = 0;

    try {
      if (rpcUrl) {
        const client = createPublicClient({
          chain: isBase ? base : mainnet,
          transport: http(rpcUrl),
        });

        const block = await client.getBlock({ blockTag: "pending" });
        const txCount = block.transactions.length;

        // Estimate competitor count from pending tx density
        competitorCount = Math.max(0, txCount - 50);

        const baseFee = block.baseFeePerGas ?? 0n;
        detectedGasWei = baseFee.toString();

        // Recommend 20% above current base fee when competition is detected
        const multiplier = competitorCount > 100 ? 150n : competitorCount > 20 ? 130n : 120n;
        recommendedGasWei = ((baseFee * multiplier) / 100n).toString();
      } else {
        recommendedGasWei = "0";
      }
    } catch {
      recommendedGasWei = "0";
    }

    const log = await this.prisma.botCompetitionLog.create({
      data: {
        mintTaskId: mintTaskId ?? undefined,
        network,
        collectionSlug,
        competitorCount,
        detectedGasWei,
        recommendedGasWei,
        gasAdjusted: false,
      },
    });

    // Emit WS event
    this.events.publish("bot.competition.detected", {
      logId: log.id,
      mintTaskId,
      network,
      competitorCount,
      detectedGasWei,
      recommendedGasWei,
    });

    return { competitorCount, recommendedGasWei, gasAdjusted: false };
  }
}

@Controller("bot-warfare")
@UseGuards(AuthGuard)
class BotWarfareController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly botWarfareService: BotWarfareService,
  ) {}

  @Get("logs")
  async getLogs(
    @CurrentUser() _user: CurrentUserType,
    @Query("mintTaskId") mintTaskId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.prisma.botCompetitionLog.findMany({
      where: mintTaskId ? { mintTaskId } : {},
      orderBy: { detectedAt: "desc" },
      take: limit ? Math.min(Number(limit), 200) : 50,
    });
  }

  @Get("stats")
  async getStats(@CurrentUser() _user: CurrentUserType) {
    const [total, adjusted, recent] = await Promise.all([
      this.prisma.botCompetitionLog.count(),
      this.prisma.botCompetitionLog.count({ where: { gasAdjusted: true } }),
      this.prisma.botCompetitionLog.findMany({
        orderBy: { detectedAt: "desc" },
        take: 10,
        select: { competitorCount: true, detectedAt: true, network: true },
      }),
    ]);

    const avgCompetitors =
      recent.length > 0
        ? recent.reduce((sum, l) => sum + l.competitorCount, 0) / recent.length
        : 0;

    return { total, adjusted, avgCompetitors: Math.round(avgCompetitors), recent };
  }
}

@Module({
  imports: [EventsModule],
  controllers: [BotWarfareController],
  providers: [BotWarfareService],
  exports: [BotWarfareService],
})
export class BotWarfareModule {}
