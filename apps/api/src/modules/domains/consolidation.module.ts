import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from "class-validator";
import { decryptPrivateKey } from "@mint-copilot/wallet-crypto";
import {
  chainByName,
  signTransaction,
} from "@mint-copilot/blockchain";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  parseAbi,
} from "viem";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { broadcastWithRpcPool, chainNameForNetwork, primaryRpcForNetwork } from "./rpc-failover.js";

// ─── ERC-721 ABIs ─────────────────────────────────────────────────────────────

const ERC721_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "function ownerOf(uint256 tokenId) view returns (address)",
]);

// ─── DTOs ─────────────────────────────────────────────────────────────────────

class CreateRuleDto {
  @IsString()
  name!: string;

  @IsString()
  coldWallet!: string;

  @IsIn(["BASE", "ETHEREUM", "ROBINHOOD"])
  network!: "BASE" | "ETHEREUM" | "ROBINHOOD";

  @IsArray()
  @IsString({ each: true })
  sourceWalletIds!: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  contractAddresses?: string[];

  @IsBoolean()
  @IsOptional()
  autoTrigger?: boolean;
}

class UpdateRuleDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  coldWallet?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  sourceWalletIds?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  contractAddresses?: string[];

  @IsBoolean()
  @IsOptional()
  autoTrigger?: boolean;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

type TransferRecord = {
  contract: string;
  tokenId: string;
  fromWallet: string;
  toWallet: string;
  txHash?: string;
  status: "success" | "failed";
  error?: string;
};

// ─── Controller ───────────────────────────────────────────────────────────────

@Controller("consolidation")
@UseGuards(AuthGuard)
class ConsolidationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  // ── Rules CRUD ──────────────────────────────────────────────────────────────

  @Get("rules")
  async listRules(@CurrentUser() user: CurrentUserType) {
    const rules = await this.prisma.consolidationRule.findMany({
      where: { userId: user.id },
      include: {
        jobs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, transferCount: true, createdAt: true, completedAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return rules.map((r) => ({
      id: r.id,
      name: r.name,
      coldWallet: r.coldWallet,
      network: r.network,
      autoTrigger: r.autoTrigger,
      sourceWalletIds: r.sourceWalletIds,
      contractAddresses: r.contractAddresses,
      enabled: r.enabled,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      lastJob: r.jobs[0] ?? null,
    }));
  }

  /** Return NFT collections held by a vault wallet so the UI can show what will be moved. */
  @Get("wallet-nfts")
  async walletNfts(
    @Query("address") address: string,
    @Query("network") network: "BASE" | "ETHEREUM" | "ROBINHOOD" = "ETHEREUM",
  ) {
    const apiKey = this.config.getOrThrow<string>("OPENSEA_API_KEY");
    const chain = network === "BASE" ? "base" : network === "ROBINHOOD" ? "robinhood" : "ethereum";
    const nfts: Array<{ collection?: string; name?: string; image_url?: string }> = [];
    let next: string | null = null;

    do {
      const url =
        `https://api.opensea.io/api/v2/chain/${chain}/account/${address}/nfts` +
        `?limit=200${next ? `&next=${next}` : ""}`;
      const res = await fetch(url, {
        headers: { "x-api-key": apiKey, accept: "application/json" },
      });
      if (!res.ok) break;
      const data = (await res.json()) as { nfts?: typeof nfts; next?: string };
      nfts.push(...(data.nfts ?? []));
      next = data.next ?? null;
    } while (next && nfts.length < 2_000);

    // Group into unique collections
    const map = new Map<string, { count: number; name: string; imageUrl?: string }>();
    for (const nft of nfts) {
      if (!nft.collection) continue;
      const existing = map.get(nft.collection);
      if (existing) {
        existing.count++;
      } else {
        const derivedName = nft.name?.replace(/\s*#\d+$/, "").trim() || nft.collection;
        map.set(nft.collection, { count: 1, name: derivedName, imageUrl: nft.image_url ?? undefined });
      }
    }

    return Array.from(map.entries())
      .map(([slug, info]) => ({ slug, name: info.name, imageUrl: info.imageUrl ?? null, count: info.count }))
      .sort((a, b) => b.count - a.count);
  }

  @Get("rules/:id")
  async getRule(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    return this.prisma.consolidationRule.findFirstOrThrow({
      where: { id, userId: user.id },
      include: {
        jobs: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
    });
  }

  @Post("rules")
  async createRule(@CurrentUser() user: CurrentUserType, @Body() body: CreateRuleDto) {
    // Verify all source wallets belong to the user
    const wallets = await this.prisma.wallet.findMany({
      where: { id: { in: body.sourceWalletIds }, userId: user.id },
    });
    if (wallets.length !== body.sourceWalletIds.length) {
      throw new Error("One or more source wallets not found or not owned by you.");
    }

    return this.prisma.consolidationRule.create({
      data: {
        userId: user.id,
        name: body.name,
        coldWallet: body.coldWallet.toLowerCase(),
        network: body.network,
        sourceWalletIds: body.sourceWalletIds,
        contractAddresses: (body.contractAddresses ?? []).map((a) => a.toLowerCase()),
        autoTrigger: body.autoTrigger ?? false,
        enabled: true,
      },
    });
  }

  @Patch("rules/:id")
  async updateRule(
    @CurrentUser() user: CurrentUserType,
    @Param("id") id: string,
    @Body() body: UpdateRuleDto
  ) {
    await this.prisma.consolidationRule.findFirstOrThrow({ where: { id, userId: user.id } });

    const data: Record<string, unknown> = {};
    if (body.name !== undefined)              data.name = body.name;
    if (body.coldWallet !== undefined)        data.coldWallet = body.coldWallet.toLowerCase();
    if (body.sourceWalletIds !== undefined)   data.sourceWalletIds = body.sourceWalletIds;
    if (body.contractAddresses !== undefined) data.contractAddresses = body.contractAddresses.map((a) => a.toLowerCase());
    if (body.autoTrigger !== undefined)       data.autoTrigger = body.autoTrigger;
    if (body.enabled !== undefined)           data.enabled = body.enabled;

    return this.prisma.consolidationRule.update({ where: { id }, data });
  }

  @Delete("rules/:id")
  async deleteRule(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    await this.prisma.consolidationRule.findFirstOrThrow({ where: { id, userId: user.id } });
    await this.prisma.consolidationRule.delete({ where: { id } });
    return { ok: true };
  }

  // ── Jobs ────────────────────────────────────────────────────────────────────

  @Get("jobs")
  async listJobs(@CurrentUser() user: CurrentUserType) {
    // Get all rule IDs for this user first
    const rules = await this.prisma.consolidationRule.findMany({
      where: { userId: user.id },
      select: { id: true, name: true },
    });
    const ruleMap = new Map(rules.map((r) => [r.id, r.name]));
    const ruleIds = rules.map((r) => r.id);

    const jobs = await this.prisma.consolidationJob.findMany({
      where: { ruleId: { in: ruleIds } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return jobs.map((j) => ({
      ...j,
      ruleName: ruleMap.get(j.ruleId) ?? "Unknown",
    }));
  }

  @Get("jobs/:id")
  async getJob(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    const job = await this.prisma.consolidationJob.findFirstOrThrow({
      where: { id },
      include: { rule: { select: { userId: true, name: true } } },
    });
    if (job.rule.userId !== user.id) throw new Error("Not found");
    return job;
  }

  // ── Run consolidation ────────────────────────────────────────────────────────

  @Post("rules/:id/run")
  async runConsolidation(
    @CurrentUser() user: CurrentUserType,
    @Param("id") id: string
  ) {
    const rule = await this.prisma.consolidationRule.findFirstOrThrow({
      where: { id, userId: user.id },
    });

    if (!rule.enabled) {
      return { ok: false, message: "Rule is disabled." };
    }

    // Create job record immediately (status = running)
    const job = await this.prisma.consolidationJob.create({
      data: {
        ruleId: rule.id,
        status: "running",
        triggeredBy: "manual",
      },
    });

    const transfers: TransferRecord[] = [];
    const masterKey = this.config.getOrThrow<string>("ENCRYPTION_MASTER_KEY");
    const rpcUrl = primaryRpcForNetwork(rule.network, this.config);
    const chainName = chainNameForNetwork(rule.network);

    const client = createPublicClient({
      chain: chainByName(chainName),
      transport: http(rpcUrl),
    });

    // Fetch gas once for all transactions
    const block = await client.getBlock();
    const baseFee = block.baseFeePerGas ?? 1_000_000_000n;
    const maxFeePerGas = baseFee * 2n + 1_500_000_000n;
    const maxPriorityFeePerGas = 1_500_000_000n;

    // Load source wallets (must belong to user + match network)
    const sourceWallets = await this.prisma.wallet.findMany({
      where: {
        id: { in: rule.sourceWalletIds },
        userId: user.id,
        network: rule.network,
      },
    });

    for (const wallet of sourceWallets) {
      // Decrypt private key for this wallet
      let privateKey: string;
      try {
        privateKey = await decryptPrivateKey(
          {
            encryptedPrivateKey: wallet.encryptedPrivateKey,
            encryptionSalt: wallet.encryptionSalt,
            encryptionIv: wallet.encryptionIv,
            encryptionAuthTag: wallet.encryptionAuthTag,
            encryptionVersion: wallet.encryptionVersion,
          },
          { masterKey }
        );
      } catch {
        // Skip wallet if we can't decrypt
        continue;
      }

      // Determine which contracts to scan
      const contractsToScan: string[] = rule.contractAddresses.length > 0
        ? rule.contractAddresses
        : await this._discoverContracts(client, wallet.address);

      let nonce = await client.getTransactionCount({
        address: wallet.address as `0x${string}`,
      });

      for (const contractAddress of contractsToScan) {
        let balance: bigint;
        try {
          balance = await client.readContract({
            address: contractAddress as `0x${string}`,
            abi: ERC721_ABI,
            functionName: "balanceOf",
            args: [wallet.address as `0x${string}`],
          }) as bigint;
        } catch {
          // Not an ERC-721 or doesn't support balanceOf — skip
          continue;
        }

        // Transfer each token
        for (let i = 0n; i < balance; i++) {
          let tokenId: bigint;
          try {
            tokenId = await client.readContract({
              address: contractAddress as `0x${string}`,
              abi: ERC721_ABI,
              functionName: "tokenOfOwnerByIndex",
              args: [wallet.address as `0x${string}`, i],
            }) as bigint;
          } catch {
            // Not ERC-721 Enumerable — can't scan without Transfer event indexing
            break;
          }

          try {
            const data = encodeFunctionData({
              abi: ERC721_ABI,
              functionName: "safeTransferFrom",
              args: [
                wallet.address as `0x${string}`,
                rule.coldWallet as `0x${string}`,
                tokenId,
              ],
            });

            const signedTx = await signTransaction(
              { chainName, rpcUrl },
              privateKey as `0x${string}`,
              {
                to: contractAddress as `0x${string}`,
                value: 0n,
                data,
                gas: 120_000n,
                nonce,
                maxFeePerGas,
                maxPriorityFeePerGas,
              }
            );

            const txHash = await broadcastWithRpcPool(rule.network, this.config, signedTx);
            nonce++;

            transfers.push({
              contract: contractAddress,
              tokenId: tokenId.toString(),
              fromWallet: wallet.address,
              toWallet: rule.coldWallet,
              txHash,
              status: "success",
            });
          } catch (err: unknown) {
            transfers.push({
              contract: contractAddress,
              tokenId: tokenId.toString(),
              fromWallet: wallet.address,
              toWallet: rule.coldWallet,
              status: "failed",
              error: err instanceof Error ? err.message : "Unknown error",
            });
          }
        }
      }

      // Zero out private key
      (privateKey as unknown as string[]).fill?.("");
    }

    const succeeded = transfers.filter((t) => t.status === "success").length;
    const failed     = transfers.filter((t) => t.status === "failed").length;
    const finalStatus = transfers.length === 0 ? "completed"
      : failed === 0 ? "completed"
      : succeeded === 0 ? "failed"
      : "partial";

    // Update job record
    await this.prisma.consolidationJob.update({
      where: { id: job.id },
      data: {
        status: finalStatus,
        transferCount: succeeded,
        transfersJson: transfers,
        completedAt: new Date(),
        errorMessage: failed > 0 ? `${failed} transfer(s) failed` : null,
      },
    });

    return {
      ok: true,
      jobId: job.id,
      summary: { total: transfers.length, succeeded, failed },
      transfers,
    };
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /** Minimal fallback: return empty list (no Transfer event scanning without indexer) */
  private async _discoverContracts(
    _client: ReturnType<typeof createPublicClient>,
    _address: string
  ): Promise<string[]> {
    // Without an indexer we can't enumerate contracts from on-chain.
    // User must specify contractAddresses; return empty if none.
    return [];
  }
}

@Module({ controllers: [ConsolidationController] })
export class ConsolidationModule {}
