import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { NotificationsModule, NotificationsService } from "./notifications.module.js";
import { EventsGateway } from "../events/events.gateway.js";
import { EventsModule } from "../events/events.module.js";

// ── DTOs ──────────────────────────────────────────────────────────────────────

class AddTrackedWalletDto {
  @IsString()
  address!: string;

  @IsString()
  @MaxLength(32)
  nickname!: string;

  @IsIn(["BASE", "ETHEREUM", "ROBINHOOD"])
  network!: "BASE" | "ETHEREUM" | "ROBINHOOD";
}

class UpdateTrackedWalletDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  nickname?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

// ── OpenSea helpers ───────────────────────────────────────────────────────────

interface OpenSeaPurchaseEvent {
  event_type: string;
  closing_date?: number;
  transaction?: string;
  nft?: {
    identifier?: string;
    collection?: string;
    name?: string;
    image_url?: string;
  };
  payment?: { quantity?: string; decimals?: number };
  seller?: string;
  buyer?: string;
  order_hash?: string;
  protocol_address?: string;
}

function parsePurchasePriceEth(event: OpenSeaPurchaseEvent): number {
  const qty = event.payment?.quantity;
  const dec = event.payment?.decimals ?? 18;
  if (!qty) return 0;
  try {
    return Number(BigInt(qty)) / 10 ** dec;
  } catch {
    return 0;
  }
}

function inferSource(event: OpenSeaPurchaseEvent): string {
  const addr = (event.protocol_address ?? "").toLowerCase();
  if (addr.includes("0x00000000000000adc04c56bf30ac9d3c0aaf14dc")) return "Seaport";
  if (addr.includes("0x000000000000ad05ccc4f10045630fb830b95127")) return "Blur";
  return "OpenSea";
}

async function fetchWalletPurchases(
  apiKey: string,
  walletAddress: string,
  afterTimestamp: number,
): Promise<OpenSeaPurchaseEvent[]> {
  const url =
    `https://api.opensea.io/api/v2/events/accounts/${encodeURIComponent(walletAddress)}` +
    `?event_type=sale&after=${afterTimestamp}&limit=50`;
  try {
    const res = await fetch(url, {
      headers: { "x-api-key": apiKey, accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { asset_events?: OpenSeaPurchaseEvent[] };
    // Return events where this wallet is the buyer
    return (data.asset_events ?? []).filter(
      (e) => e.buyer?.toLowerCase() === walletAddress.toLowerCase(),
    );
  } catch {
    return [];
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class TraderTrackerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly events: EventsGateway,
  ) {}

  /** Poll a single tracked wallet for new purchases and store them. */
  async pollWallet(walletId: string): Promise<{ newPurchases: number }> {
    const wallet = await this.prisma.trackedWallet.findUniqueOrThrow({ where: { id: walletId } });
    if (!wallet.enabled) return { newPurchases: 0 };

    const apiKey = this.config.getOrThrow<string>("OPENSEA_API_KEY");

    // Look back 5 minutes (or since last check)
    const afterTimestamp = wallet.lastCheckedAt
      ? Math.floor(wallet.lastCheckedAt.getTime() / 1000) - 30
      : Math.floor(Date.now() / 1000) - 300;

    const purchases = await fetchWalletPurchases(apiKey, wallet.address, afterTimestamp);

    let newPurchases = 0;

    for (const event of purchases) {
      const priceEth = parsePurchasePriceEth(event);
      const collectionSlug = event.nft?.collection ?? "unknown";
      const eventTime = event.closing_date
        ? new Date(event.closing_date * 1000)
        : new Date();

      // Skip if already logged (dedupe by txHash + collection)
      if (event.transaction) {
        const exists = await this.prisma.traderPurchaseLog.findFirst({
          where: { trackedWalletId: walletId, txHash: event.transaction },
        });
        if (exists) continue;
      }

      await this.prisma.traderPurchaseLog.create({
        data: {
          trackedWalletId: walletId,
          collectionSlug,
          collectionName: collectionSlug,
          nftName: event.nft?.name ?? null,
          imageUrl: event.nft?.image_url ?? null,
          priceEth,
          quantity: 1,
          source: inferSource(event),
          txHash: event.transaction ?? null,
          eventTimestamp: eventTime,
        },
      });

      newPurchases++;

      // Send notification (best-effort)
      const notifPayload: Record<string, unknown> = {
        traderNickname: wallet.nickname,
        walletAddress: wallet.address,
        collectionSlug,
        priceEth: priceEth.toFixed(4),
        source: inferSource(event),
        nftName: event.nft?.name ?? null,
      };
      await this.notifications.sendNotification(wallet.userId, "SWEEP_DETECTED", notifPayload).catch(() => undefined);

      // Emit WS event for live UI updates
      this.events.publish("trader.purchase", {
        walletId,
        nickname: wallet.nickname,
        address: wallet.address,
        collectionSlug,
        collectionName: collectionSlug,
        nftName: event.nft?.name,
        imageUrl: event.nft?.image_url,
        priceEth,
        source: inferSource(event),
        txHash: event.transaction,
        eventTimestamp: eventTime,
      });
    }

    await this.prisma.trackedWallet.update({
      where: { id: walletId },
      data: { lastCheckedAt: new Date() },
    });

    return { newPurchases };
  }

  /** Poll all enabled wallets — called by scheduler. */
  async pollAll(): Promise<void> {
    const wallets = await this.prisma.trackedWallet.findMany({ where: { enabled: true } });
    await Promise.allSettled(wallets.map((w) => this.pollWallet(w.id)));
  }
}

// ── Controller ────────────────────────────────────────────────────────────────

@Controller("trader-tracker")
@UseGuards(AuthGuard)
class TraderTrackerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trackerService: TraderTrackerService,
  ) {}

  /** List all tracked wallets with recent purchases */
  @Get()
  list(@CurrentUser() user: CurrentUserType) {
    return this.prisma.trackedWallet.findMany({
      where: { userId: user.id },
      include: {
        purchases: {
          orderBy: { detectedAt: "desc" },
          take: 10,
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Get recent purchase feed across all wallets */
  @Get("feed")
  async feed(@CurrentUser() user: CurrentUserType) {
    const wallets = await this.prisma.trackedWallet.findMany({
      where: { userId: user.id },
      select: { id: true },
    });
    const ids = wallets.map((w) => w.id);
    return this.prisma.traderPurchaseLog.findMany({
      where: { trackedWalletId: { in: ids } },
      include: {
        trackedWallet: { select: { nickname: true, address: true, network: true } },
      },
      orderBy: { detectedAt: "desc" },
      take: 100,
    });
  }

  /** Add a wallet to track */
  @Post()
  async add(@CurrentUser() user: CurrentUserType, @Body() body: AddTrackedWalletDto) {
    const address = body.address.trim().toLowerCase();
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new BadRequestException("Invalid Ethereum address.");
    }
    try {
      return await this.prisma.trackedWallet.create({
        data: {
          userId: user.id,
          address,
          nickname: body.nickname.trim(),
          network: body.network,
          enabled: true,
        },
        include: { purchases: true },
      });
    } catch {
      throw new BadRequestException("This wallet is already being tracked on that network.");
    }
  }

  /** Update nickname or enabled state */
  @Patch(":id")
  async update(
    @CurrentUser() user: CurrentUserType,
    @Param("id") id: string,
    @Body() body: UpdateTrackedWalletDto,
  ) {
    await this.prisma.trackedWallet.findFirstOrThrow({ where: { id, userId: user.id } });
    return this.prisma.trackedWallet.update({
      where: { id },
      data: {
        ...(body.nickname !== undefined && { nickname: body.nickname.trim() }),
        ...(body.enabled !== undefined && { enabled: body.enabled }),
      },
      include: { purchases: { orderBy: { detectedAt: "desc" }, take: 10 } },
    });
  }

  /** Remove a tracked wallet */
  @Delete(":id")
  async remove(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    const wallet = await this.prisma.trackedWallet.findFirst({ where: { id, userId: user.id } });
    if (!wallet) throw new NotFoundException("Tracked wallet not found.");
    await this.prisma.trackedWallet.delete({ where: { id } });
    return { ok: true };
  }

  /** Manual poll — refresh purchases now */
  @Post(":id/poll")
  async poll(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    await this.prisma.trackedWallet.findFirstOrThrow({ where: { id, userId: user.id } });
    return this.trackerService.pollWallet(id);
  }
}

// ── Module ────────────────────────────────────────────────────────────────────

@Module({
  imports: [EventsModule, NotificationsModule],
  controllers: [TraderTrackerController],
  providers: [TraderTrackerService],
  exports: [TraderTrackerService],
})
export class TraderTrackerModule {}
