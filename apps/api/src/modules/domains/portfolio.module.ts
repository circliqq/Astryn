import {
  Body,
  Controller,
  Get,
  Module,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IsIn, IsOptional, IsString } from "class-validator";
import { createPublicClient, http, parseAbi } from "viem";
import { base, mainnet } from "viem/chains";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";

const ERC721_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function name() view returns (string)",
]);

class SyncPortfolioDto {
  @IsOptional()
  @IsIn(["BASE", "ETHEREUM"])
  network?: "BASE" | "ETHEREUM";

  @IsOptional()
  @IsString()
  contractAddress?: string;
}

@Controller("portfolio")
@UseGuards(AuthGuard)
class PortfolioController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: CurrentUserType,
    @Query("network") network?: string,
  ) {
    const items = await this.prisma.portfolioItem.findMany({
      where: {
        userId: user.id,
        ...(network ? { network: network as "BASE" | "ETHEREUM" } : {}),
      },
      orderBy: { acquiredAt: "desc" },
    });

    return items.map((item) => {
      const acquired = BigInt(item.acquiredPriceWei);
      const current = item.currentPriceWei ? BigInt(item.currentPriceWei) : acquired;
      const pnl = current - acquired;
      const pnlPct = acquired > 0n ? Number((pnl * 10000n) / acquired) / 100 : 0;
      return {
        ...item,
        acquiredPriceEth: (Number(acquired) / 1e18).toFixed(6),
        currentPriceEth: (Number(current) / 1e18).toFixed(6),
        pnlEth: (Number(pnl) / 1e18).toFixed(6),
        pnlPct,
      };
    });
  }

  @Get("summary")
  async summary(@CurrentUser() user: CurrentUserType) {
    const items = await this.prisma.portfolioItem.findMany({ where: { userId: user.id } });

    const byNetwork: Record<string, { holdings: number; totalAcquiredWei: bigint; totalCurrentWei: bigint }> = {};

    for (const item of items) {
      const net = item.network;
      if (!byNetwork[net]) byNetwork[net] = { holdings: 0, totalAcquiredWei: 0n, totalCurrentWei: 0n };
      byNetwork[net].holdings += 1;
      byNetwork[net].totalAcquiredWei += BigInt(item.acquiredPriceWei);
      byNetwork[net].totalCurrentWei += item.currentPriceWei ? BigInt(item.currentPriceWei) : BigInt(item.acquiredPriceWei);
    }

    return Object.entries(byNetwork).map(([network, data]) => ({
      network,
      holdings: data.holdings,
      totalAcquiredEth: (Number(data.totalAcquiredWei) / 1e18).toFixed(6),
      totalCurrentEth: (Number(data.totalCurrentWei) / 1e18).toFixed(6),
      totalPnlEth: (Number(data.totalCurrentWei - data.totalAcquiredWei) / 1e18).toFixed(6),
    }));
  }

  @Post("sync")
  async sync(@CurrentUser() user: CurrentUserType, @Body() body: SyncPortfolioDto) {
    const wallets = await this.prisma.wallet.findMany({
      where: {
        userId: user.id,
        ...(body.network ? { network: body.network } : {}),
      },
    });

    if (wallets.length === 0) return { synced: 0, message: "No wallets found." };

    let synced = 0;

    for (const wallet of wallets) {
      const isBase = wallet.network === "BASE";
      const rpcUrl = this.config.get<string>(isBase ? "BASE_RPC_PRIMARY" : "ETH_RPC_PRIMARY");
      if (!rpcUrl) continue;

      const client = createPublicClient({
        chain: isBase ? base : mainnet,
        transport: http(rpcUrl),
      });

      // If a specific contract address is provided, scan only that
      const contractsToScan = body.contractAddress ? [body.contractAddress] : [];

      if (contractsToScan.length === 0) {
        // No specific contract — just upsert from existing portfolio items for this wallet
        const existing = await this.prisma.portfolioItem.findMany({
          where: { userId: user.id, walletAddress: wallet.address, network: wallet.network },
        });
        contractsToScan.push(...[...new Set(existing.map((i) => i.contractAddress))]);
      }

      for (const contractAddress of contractsToScan) {
        try {
          const balance = await client.readContract({
            address: contractAddress as `0x${string}`,
            abi: ERC721_ABI,
            functionName: "balanceOf",
            args: [wallet.address as `0x${string}`],
          });

          let collectionName: string | undefined;
          try {
            collectionName = await client.readContract({
              address: contractAddress as `0x${string}`,
              abi: ERC721_ABI,
              functionName: "name",
            });
          } catch {
            collectionName = undefined;
          }

          for (let i = 0n; i < balance; i++) {
            try {
              const tokenId = await client.readContract({
                address: contractAddress as `0x${string}`,
                abi: ERC721_ABI,
                functionName: "tokenOfOwnerByIndex",
                args: [wallet.address as `0x${string}`, i],
              });

              await this.prisma.portfolioItem.upsert({
                where: {
                  userId_network_contractAddress_tokenId: {
                    userId: user.id,
                    network: wallet.network,
                    contractAddress,
                    tokenId: tokenId.toString(),
                  },
                },
                create: {
                  userId: user.id,
                  network: wallet.network,
                  walletAddress: wallet.address,
                  contractAddress,
                  tokenId: tokenId.toString(),
                  collectionName: collectionName ?? undefined,
                  acquiredPriceWei: "0",
                  acquiredAt: new Date(),
                },
                update: {
                  collectionName: collectionName ?? undefined,
                },
              });
              synced++;
            } catch {
              // Skip individual token errors
            }
          }
        } catch {
          // Skip contract errors
        }
      }
    }

    return { synced, message: `Synced ${synced} NFT holdings.` };
  }
}

@Module({ controllers: [PortfolioController] })
export class PortfolioModule {}
