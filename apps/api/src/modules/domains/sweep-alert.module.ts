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
  Query,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { NotificationsModule, NotificationsService } from "./notifications.module.js";
import { EventsGateway } from "../events/events.gateway.js";
import { EventsModule } from "../events/events.module.js";

// ── DTOs ─────────────────────────────────────────────────────────────────────

class CreateSweepAlertDto {
  @IsString()
  collectionSlug!: string;

  @IsIn(["BASE", "ETHEREUM", "ROBINHOOD"])
  network!: "BASE" | "ETHEREUM" | "ROBINHOOD";

  @IsOptional()
  @IsNumber()
  @Min(2)
  @Max(200)
  minItems?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(3600)
  windowSeconds?: number;
}

class BatchAlertItemDto {
  @IsString()
  collectionSlug!: string;

  @IsIn(["BASE", "ETHEREUM", "ROBINHOOD"])
  network!: "BASE" | "ETHEREUM" | "ROBINHOOD";

  @IsOptional()
  @IsNumber()
  @Min(2)
  @Max(200)
  minItems?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(3600)
  windowSeconds?: number;
}

class BatchCreateSweepAlertsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchAlertItemDto)
  alerts!: BatchAlertItemDto[];

  @IsOptional()
  @IsNumber()
  @Min(2)
  @Max(200)
  defaultMinItems?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(3600)
  defaultWindowSeconds?: number;
}

class UpdateSweepAlertDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(2)
  @Max(200)
  minItems?: number;

  @IsOptional()
  @IsNumber()
  @Min(10)
  @Max(3600)
  windowSeconds?: number;
}

// ── OpenSea events helper ─────────────────────────────────────────────────────

interface OpenSeaSaleEvent {
  event_type: string;
  closing_date: number;
  payment?: { quantity?: string; decimals?: number };
}

async function fetchRecentSales(
  apiKey: string,
  collectionSlug: string,
  afterTimestamp: number,
): Promise<OpenSeaSaleEvent[]> {
  const url =
    `https://api.opensea.io/api/v2/events/collection/${encodeURIComponent(collectionSlug)}` +
    `?event_type=sale&after=${afterTimestamp}&limit=50`;
  try {
    const res = await fetch(url, {
      headers: { "x-api-key": apiKey, accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { asset_events?: OpenSeaSaleEvent[] };
    return data.asset_events ?? [];
  } catch {
    return [];
  }
}

// ── OpenSea profile helpers ───────────────────────────────────────────────────

interface OpenSeaCollectionEntry {
  collection: string;   // slug
  name: string;
  image_url?: string;
  owned_asset_count?: number;
}

interface OpenSeaNFTEntry {
  collection?: string;
  name?: string;
  image_url?: string;
}

/** Resolve OpenSea URL / username / address → wallet address */
async function resolveWalletAddress(apiKey: string, input: string): Promise<string> {
  const trimmed = input.trim();

  // Extract from full URL: https://opensea.io/TMA420  or  opensea.io/TMA420
  const urlMatch = trimmed.match(/opensea\.io\/([^/?#]+)/i);
  const identifier = urlMatch ? urlMatch[1] : trimmed;

  // If already an ETH address, return as-is
  if (/^0x[a-fA-F0-9]{40}$/.test(identifier)) return identifier.toLowerCase();

  // Otherwise resolve username via OpenSea accounts API
  const res = await fetch(`https://api.opensea.io/api/v2/accounts/${encodeURIComponent(identifier)}`, {
    headers: { "x-api-key": apiKey, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Could not resolve OpenSea username "${identifier}" (${res.status}).`);
  const data = (await res.json()) as { address?: string };
  if (!data.address) throw new Error(`OpenSea account "${identifier}" has no associated wallet address.`);
  return data.address.toLowerCase();
}

/**
 * Fetch all NFTs owned by a wallet, then group into unique collections.
 * Uses /api/v2/chain/{chain}/account/{address}/nfts — the correct v2 endpoint
 * for holdings. The old collections?asset_owner= param is unsupported and
 * returns unrelated results.
 */
async function fetchWalletCollections(
  apiKey: string,
  walletAddress: string,
  chain: "ethereum" | "base" | "robinhood",
): Promise<OpenSeaCollectionEntry[]> {
  const nfts: OpenSeaNFTEntry[] = [];
  let next: string | null = null;

  // Page through NFTs (max 5 000 to keep response time reasonable)
  do {
    const url =
      `https://api.opensea.io/api/v2/chain/${chain}/account/${walletAddress}/nfts` +
      `?limit=200${next ? `&next=${next}` : ""}`;
    const res = await fetch(url, {
      headers: { "x-api-key": apiKey, accept: "application/json" },
    });
    if (!res.ok) break;
    const data = (await res.json()) as { nfts?: OpenSeaNFTEntry[]; next?: string };
    nfts.push(...(data.nfts ?? []));
    next = data.next ?? null;
  } while (next && nfts.length < 5_000);

  // Group by collection slug — count held items and pick one image per collection
  const map = new Map<string, { count: number; imageUrl?: string; name?: string }>();
  for (const nft of nfts) {
    if (!nft.collection) continue;
    const entry = map.get(nft.collection);
    if (entry) {
      entry.count++;
    } else {
      // Derive a human-readable collection name by stripping the trailing #N from NFT name
      const derivedName = nft.name?.replace(/\s*#\d+$/, "").trim() || nft.collection;
      map.set(nft.collection, { count: 1, imageUrl: nft.image_url ?? undefined, name: derivedName });
    }
  }

  // Sort by most-held first so high-conviction collections surface at the top
  return Array.from(map.entries())
    .map(([slug, info]) => ({
      collection: slug,
      name: info.name ?? slug,
      image_url: info.imageUrl,
      owned_asset_count: info.count,
    }))
    .sort((a, b) => (b.owned_asset_count ?? 0) - (a.owned_asset_count ?? 0));
}

function parsePriceEth(event: OpenSeaSaleEvent): number | null {
  const qty = event.payment?.quantity;
  const dec = event.payment?.decimals ?? 18;
  if (!qty) return null;
  try {
    return Number(BigInt(qty)) / 10 ** dec;
  } catch {
    return null;
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class SweepAlertService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly events: EventsGateway,
  ) {}

  /** Poll a single sweep alert against OpenSea events. Returns detection log if sweep found. */
  async checkAlert(alertId: string): Promise<{
    detected: boolean;
    itemCount: number;
    windowSeconds: number;
    salePrices: number[];
  }> {
    const alert = await this.prisma.sweepAlert.findUniqueOrThrow({ where: { id: alertId } });
    if (!alert.enabled) return { detected: false, itemCount: 0, windowSeconds: alert.windowSeconds, salePrices: [] };

    const apiKey = this.config.getOrThrow<string>("OPENSEA_API_KEY");
    const afterTimestamp = Math.floor(Date.now() / 1000) - alert.windowSeconds;

    const sales = await fetchRecentSales(apiKey, alert.collectionSlug, afterTimestamp);
    const salePrices = sales.map(parsePriceEth).filter((p): p is number => p !== null);
    const itemCount = sales.length;

    if (itemCount < alert.minItems) {
      return { detected: false, itemCount, windowSeconds: alert.windowSeconds, salePrices };
    }

    // Record detection
    await this.prisma.sweepDetectionLog.create({
      data: {
        sweepAlertId: alert.id,
        collectionSlug: alert.collectionSlug,
        network: alert.network,
        itemCount,
        windowSeconds: alert.windowSeconds,
        salePricesJson: salePrices,
      },
    });

    await this.prisma.sweepAlert.update({
      where: { id: alert.id },
      data: { lastTriggeredAt: new Date() },
    });

    // Send notification
    await this.notifications.sendNotification(alert.userId, "SWEEP_DETECTED", {
      collectionSlug: alert.collectionSlug,
      network: alert.network,
      itemCount,
      windowSeconds: alert.windowSeconds,
      minPriceEth: salePrices.length ? Math.min(...salePrices).toFixed(4) : null,
      maxPriceEth: salePrices.length ? Math.max(...salePrices).toFixed(4) : null,
    });

    // Emit WS event
    this.events.publish("sweep.detected", {
      alertId: alert.id,
      collectionSlug: alert.collectionSlug,
      network: alert.network,
      itemCount,
      windowSeconds: alert.windowSeconds,
      salePrices,
    });

    return { detected: true, itemCount, windowSeconds: alert.windowSeconds, salePrices };
  }

  /** Poll all enabled alerts for all users — called by the scheduler. */
  async pollAll(): Promise<void> {
    const alerts = await this.prisma.sweepAlert.findMany({ where: { enabled: true } });
    await Promise.allSettled(alerts.map((a) => this.checkAlert(a.id)));
  }
}

// ── Controller ────────────────────────────────────────────────────────────────

@Controller("sweep-alerts")
@UseGuards(AuthGuard)
class SweepAlertController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly sweepAlertService: SweepAlertService,
  ) {}

  @Get()
  list(@CurrentUser() user: CurrentUserType) {
    return this.prisma.sweepAlert.findMany({
      where: { userId: user.id },
      include: {
        detections: {
          orderBy: { detectedAt: "desc" },
          take: 5,
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  @Post()
  async create(@CurrentUser() user: CurrentUserType, @Body() body: CreateSweepAlertDto) {
    try {
      return await this.prisma.sweepAlert.create({
        data: {
          userId: user.id,
          collectionSlug: body.collectionSlug.trim().toLowerCase(),
          network: body.network,
          minItems: body.minItems ?? 5,
          windowSeconds: body.windowSeconds ?? 60,
          enabled: true,
        },
        include: { detections: true },
      });
    } catch {
      throw new BadRequestException(
        "A sweep alert for this collection and network already exists.",
      );
    }
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: CurrentUserType,
    @Param("id") id: string,
    @Body() body: UpdateSweepAlertDto,
  ) {
    await this.prisma.sweepAlert.findFirstOrThrow({ where: { id, userId: user.id } });
    return this.prisma.sweepAlert.update({
      where: { id },
      data: {
        ...(body.enabled !== undefined && { enabled: body.enabled }),
        ...(body.minItems !== undefined && { minItems: body.minItems }),
        ...(body.windowSeconds !== undefined && { windowSeconds: body.windowSeconds }),
      },
      include: { detections: { orderBy: { detectedAt: "desc" }, take: 5 } },
    });
  }

  @Delete(":id")
  async remove(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    const alert = await this.prisma.sweepAlert.findFirst({ where: { id, userId: user.id } });
    if (!alert) throw new NotFoundException("Sweep alert not found.");
    await this.prisma.sweepAlert.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Resolve an OpenSea profile URL / username / wallet address and return
   * all NFT collections held by that account so the user can pick which to track.
   */
  @Get("import/profile")
  async importProfile(
    @CurrentUser() _user: CurrentUserType,
    @Query("url") url: string,
    @Query("network") network: "BASE" | "ETHEREUM" | "ROBINHOOD" = "ETHEREUM",
  ) {
    if (!url?.trim()) throw new BadRequestException("Provide an OpenSea profile URL, username, or wallet address.");

    const apiKey = this.config.getOrThrow<string>("OPENSEA_API_KEY");
    const chain = network === "BASE" ? "base" : network === "ROBINHOOD" ? "robinhood" : "ethereum";

    let walletAddress: string;
    try {
      walletAddress = await resolveWalletAddress(apiKey, url);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "Could not resolve profile.");
    }

    const collections = await fetchWalletCollections(apiKey, walletAddress, chain);

    return {
      walletAddress,
      network,
      collectionCount: collections.length,
      collections: collections.map((c) => ({
        slug: c.collection,
        name: c.name,
        imageUrl: c.image_url ?? null,
        ownedCount: c.owned_asset_count ?? null,
      })),
    };
  }

  /** Batch-create sweep alerts for multiple collections at once. Skips duplicates silently. */
  @Post("batch")
  async batchCreate(@CurrentUser() user: CurrentUserType, @Body() body: BatchCreateSweepAlertsDto) {
    const defaultMinItems = body.defaultMinItems ?? 5;
    const defaultWindowSeconds = body.defaultWindowSeconds ?? 60;

    const results = await Promise.allSettled(
      body.alerts.map((item) =>
        this.prisma.sweepAlert.upsert({
          where: {
            userId_collectionSlug_network: {
              userId: user.id,
              collectionSlug: item.collectionSlug.trim().toLowerCase(),
              network: item.network,
            },
          },
          create: {
            userId: user.id,
            collectionSlug: item.collectionSlug.trim().toLowerCase(),
            network: item.network,
            minItems: item.minItems ?? defaultMinItems,
            windowSeconds: item.windowSeconds ?? defaultWindowSeconds,
            enabled: true,
          },
          update: {
            enabled: true,
          },
          include: { detections: false },
        }),
      ),
    );

    const created = results.filter((r) => r.status === "fulfilled").length;
    const failed  = results.filter((r) => r.status === "rejected").length;
    return { created, failed, total: body.alerts.length };
  }

  /** Manual check — useful for testing a profile immediately. */
  @Post(":id/check")
  async check(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    await this.prisma.sweepAlert.findFirstOrThrow({ where: { id, userId: user.id } });
    return this.sweepAlertService.checkAlert(id);
  }

  /** Recent detections for one alert */
  @Get(":id/detections")
  async detections(
    @CurrentUser() user: CurrentUserType,
    @Param("id") id: string,
  ) {
    await this.prisma.sweepAlert.findFirstOrThrow({ where: { id, userId: user.id } });
    return this.prisma.sweepDetectionLog.findMany({
      where: { sweepAlertId: id },
      orderBy: { detectedAt: "desc" },
      take: 50,
    });
  }
}

// ── Module ────────────────────────────────────────────────────────────────────

@Module({
  imports: [EventsModule, NotificationsModule],
  controllers: [SweepAlertController],
  providers: [SweepAlertService],
  exports: [SweepAlertService],
})
export class SweepAlertModule {}
