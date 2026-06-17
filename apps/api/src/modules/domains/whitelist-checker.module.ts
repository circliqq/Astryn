import { BadRequestException, Body, Controller, Module, Post, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IsArray, IsOptional, IsString } from "class-validator";
import { privateKeyToAccount } from "viem/accounts";
import { decryptPrivateKey } from "@mint-copilot/wallet-crypto";
import { OpenSeaClient, parseOpenSeaUrl, type DropEligibilityStage } from "@mint-copilot/opensea";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";

class BulkWhitelistCheckDto {
  @IsString()
  collection!: string;

  @IsArray()
  @IsString({ each: true })
  walletIds!: string[];

  @IsOptional()
  @IsString()
  network?: string;
}

interface WalletCheckResult {
  walletId: string;
  walletName: string;
  walletAddress: string;
  eligible: boolean;
  stages: DropEligibilityStage[];
  error: string | null;
}

function resolveCollectionSlug(input: string) {
  const trimmed = input.trim();
  if (!trimmed) throw new BadRequestException("Enter an OpenSea collection slug or drop URL.");

  if (/^https?:\/\//i.test(trimmed)) {
    return parseOpenSeaUrl(trimmed).slug;
  }

  const dropMatch = trimmed.match(/(?:drops|collection)\/([^/?#]+)/i);
  if (dropMatch?.[1]) return dropMatch[1];

  return trimmed.replace(/^@/, "").replace(/^\/+|\/+$/g, "");
}

function stageKey(stage: DropEligibilityStage) {
  return stage.stage || stage.stageType;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
) {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

@Controller("whitelist-checker")
@UseGuards(AuthGuard)
class WhitelistCheckerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  @Post("bulk")
  async bulkCheck(@CurrentUser() user: CurrentUserType, @Body() body: BulkWhitelistCheckDto) {
    const slug = resolveCollectionSlug(body.collection);
    const walletIds = [...new Set(body.walletIds ?? [])];
    if (walletIds.length === 0) throw new BadRequestException("Select at least one wallet.");

    const wallets = await this.prisma.wallet.findMany({
      where: {
        id: { in: walletIds },
        userId: user.id,
        ...(body.network === "ethereum" ? { network: "ETHEREUM" as const } : {}),
      },
      select: {
        id: true,
        name: true,
        address: true,
        encryptedPrivateKey: true,
        encryptionSalt: true,
        encryptionIv: true,
        encryptionAuthTag: true,
        encryptionVersion: true
      }
    });

    const client = new OpenSeaClient({ apiKey: this.config.getOrThrow<string>("OPENSEA_API_KEY") });
    const masterKey = this.config.getOrThrow<string>("ENCRYPTION_MASTER_KEY");

    const results = await mapLimit(wallets, 3, async (wallet): Promise<WalletCheckResult> => {
      try {
        const privateKey = await decryptPrivateKey(
          {
            encryptedPrivateKey: wallet.encryptedPrivateKey,
            encryptionSalt: wallet.encryptionSalt,
            encryptionIv: wallet.encryptionIv,
            encryptionAuthTag: wallet.encryptionAuthTag,
            encryptionVersion: wallet.encryptionVersion
          },
          { masterKey }
        ) as `0x${string}`;
        const account = privateKeyToAccount(privateKey);
        const checked = await client.checkDropEligibilityStages(
          slug,
          account.address,
          (message) => account.signMessage({ message })
        );

        return {
          walletId: wallet.id,
          walletName: wallet.name,
          walletAddress: wallet.address,
          eligible: checked.stages.length > 0,
          stages: checked.stages,
          error: null
        };
      } catch (error) {
        return {
          walletId: wallet.id,
          walletName: wallet.name,
          walletAddress: wallet.address,
          eligible: false,
          stages: [],
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });

    const stageSummary = new Map<string, { stage: string; maxMint: number; count: number }>();
    for (const result of results) {
      for (const stage of result.stages) {
        const key = stageKey(stage);
        const current = stageSummary.get(key) ?? { stage: key, maxMint: stage.maxMint, count: 0 };
        current.count += 1;
        current.maxMint = Math.max(current.maxMint, stage.maxMint);
        stageSummary.set(key, current);
      }
    }

    return {
      collectionSlug: slug,
      checkedAt: new Date().toISOString(),
      walletCount: results.length,
      eligibleWalletCount: results.filter((result) => result.eligible).length,
      errorCount: results.filter((result) => result.error).length,
      stages: [...stageSummary.values()].sort((a, b) => a.stage.localeCompare(b.stage)),
      wallets: results
    };
  }
}

@Module({ controllers: [WhitelistCheckerController] })
export class WhitelistCheckerModule {}
