import { BadRequestException, Body, Controller, Get, Module, NotFoundException, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MintPhaseType } from "@prisma/client";
import { IsIn, IsOptional, IsString } from "class-validator";
import { OpenSeaClient, type DropPhase } from "@mint-copilot/opensea";
import { getAllowListInfo } from "@mint-copilot/blockchain";
import { AuthGuard } from "../auth/auth.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  collectionInclude,
  ethToWei,
  getCollectionWithPhaseData,
  phaseTypeToPrisma,
} from "./collection-phase.utils.js";

class ScanCollectionDto {
  @IsString()
  url!: string;
}

@Controller("collections")
@UseGuards(AuthGuard)
class CollectionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  @Post("scan")
  async scan(@Body() body: ScanCollectionDto) {
    try {
      const client = new OpenSeaClient({ apiKey: this.config.getOrThrow<string>("OPENSEA_API_KEY") });
      const drop = await client.scanDrop(body.url);
      const collection = await this.prisma.collection.upsert({
        where: { slug_chain: { slug: drop.slug, chain: drop.chain === "base" ? "BASE" : drop.chain === "robinhood" ? "ROBINHOOD" : "ETHEREUM" } },
        create: {
          slug: drop.slug,
          name: drop.name,
          imageUrl: drop.imageUrl,
          chain: drop.chain === "base" ? "BASE" : drop.chain === "robinhood" ? "ROBINHOOD" : "ETHEREUM",
          contractAddress: drop.contractAddress,
          mintPriceWei: drop.phases[0]?.priceEth ? ethToWei(drop.phases[0].priceEth) : "0",
          supply: drop.supply,
          phases: {
            create: drop.phases.map((phase: DropPhase) => ({
              phaseType: phaseTypeToPrisma(phase.type),
              name: phase.name ?? null,
              priceWei: ethToWei(phase.priceEth),
              startTime: new Date(phase.startTime),
              endTime: phase.endTime ? new Date(phase.endTime) : undefined,
              maxMint: phase.maxMintPerWallet ?? null
            }))
          }
        },
        update: {
          name: drop.name,
          imageUrl: drop.imageUrl,
          contractAddress: drop.contractAddress,
          supply: drop.supply,
          mintPriceWei: drop.phases[0]?.priceEth ? ethToWei(drop.phases[0].priceEth) : undefined,
          phases: {
            deleteMany: {},
            create: drop.phases.map((phase: DropPhase) => ({
              phaseType: phaseTypeToPrisma(phase.type),
              name: phase.name ?? null,
              priceWei: ethToWei(phase.priceEth),
              startTime: new Date(phase.startTime),
              endTime: phase.endTime ? new Date(phase.endTime) : undefined,
              maxMint: phase.maxMintPerWallet ?? null
            }))
          }
        },
        include: collectionInclude
      });
      return collection;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const message = error instanceof Error ? error.message : "Scan failed";
      throw new BadRequestException(message);
    }
  }

  @Get("by-contract/:contractAddress")
  async getCollectionByContract(@Param("contractAddress") contractAddress: string, @Query("network") network?: string) {
    const normalized = normalizeContractAddress(contractAddress);
    if (!normalized) {
      throw new BadRequestException("Enter a valid collection contract address.");
    }

    const chain = network?.toUpperCase();
    const chainFilter = chain === "BASE" ? "BASE" : chain === "ETHEREUM" ? "ETHEREUM" : undefined;
    const collection = await this.prisma.collection.findFirst({
      where: {
        contractAddress: { equals: normalized, mode: "insensitive" },
        ...(chainFilter ? { chain: chainFilter } : {})
      },
      orderBy: { updatedAt: "desc" },
      include: collectionInclude
    });

    if (!collection) {
      throw new NotFoundException("Collection not found locally. Scan the OpenSea drop once, then retry with the contract address.");
    }

    return collection;
  }

  @Post(":id/refresh-phases")
  async refreshPhases(@Param("id") id: string) {
    const result = await getCollectionWithPhaseData(this.prisma, this.config, id);
    return {
      ...result.collection,
      phaseSource: result.phaseSource,
      phaseWarning: result.phaseWarning,
      phaseCheckedAt: result.phaseCheckedAt,
    };
  }

  @Get(":id")
  getCollection(@Param("id") id: string) {
    return this.prisma.collection.findUniqueOrThrow({ where: { id }, include: collectionInclude });
  }

  @Get(":id/allowlist-info")
  async allowlistInfo(@Param("id") id: string) {
    const collection = await this.prisma.collection.findUniqueOrThrow({
      where: { id },
      select: { id: true, slug: true, contractAddress: true, chain: true }
    });

    if (!collection.contractAddress) {
      throw new BadRequestException("Collection has no contract address. Rescan it first.");
    }

    const network = collection.chain === "BASE" ? "base" : collection.chain === "ROBINHOOD" ? "robinhood" : "ethereum";
    const rpcUrl = this.config.getOrThrow<string>(
      network === "base" ? "BASE_RPC_PRIMARY" : network === "robinhood" ? "ROBINHOOD_RPC_PRIMARY" : "ETH_RPC_PRIMARY"
    );

    // ── Source 1: SeaDrop contract → getAllowListData ─────────────────────────
    let contractResult: { merkleRoot: string; allowListURI: string; addresses: string[]; count: number } | null = null;
    try {
      contractResult = await getAllowListInfo(
        { chainName: network, rpcUrl },
        collection.contractAddress as `0x${string}`
      );
    } catch {
      // Contract call failed — fall through to OpenSea
    }

    // ── Source 2: OpenSea allowlist endpoint (fallback / supplemental) ────────
    let openSeaCount: number | null = null;
    let openSeaAddresses: string[] = [];
    try {
      const client = new OpenSeaClient({ apiKey: this.config.getOrThrow<string>("OPENSEA_API_KEY") });
      // Use the internal allowlist fetch the client already supports
      const endpoints = [
        `/drops/${collection.slug}/allowlist?limit=10000`,
        `/drops/${collection.slug}/allowlist`,
        `/chain/${network}/contract/${collection.contractAddress}/drops/allowlist?limit=10000`,
      ];
      for (const ep of endpoints) {
        try {
          const data = await (client as unknown as { request: <T>(path: string) => Promise<T> }).request<Record<string, unknown>>(ep);
          const addrs = extractOpenSeaAddresses(data);
          if (addrs.length > 0) {
            openSeaAddresses = addrs;
            openSeaCount = addrs.length;
            break;
          }
        } catch { /* try next */ }
      }
    } catch { /* OpenSea unavailable */ }

    // Merge: prefer contract source (has URI + merkle root), use OpenSea count if contract had no addresses
    const addresses = contractResult?.addresses.length
      ? contractResult.addresses
      : openSeaAddresses;

    const count = addresses.length || openSeaCount || contractResult?.count || 0;

    return {
      collectionId: collection.id,
      contractAddress: collection.contractAddress,
      merkleRoot: contractResult?.merkleRoot ?? null,
      allowListURI: contractResult?.allowListURI ?? null,
      eligibleAddressCount: count,
      addresses: addresses.slice(0, 500), // cap response size — full list in allowListURI
      hasMoreAddresses: addresses.length > 500,
      source: contractResult?.allowListURI
        ? "contract+uri"
        : openSeaCount !== null
          ? "opensea"
          : contractResult
            ? "contract-root-only"
            : "unavailable",
      checkedAt: new Date().toISOString()
    };
  }

  @Get(":id/market-summary")
  async marketSummary(@Param("id") id: string) {
    const collection = await this.prisma.collection.findUniqueOrThrow({
      where: { id },
      select: { id: true, slug: true }
    });
    const client = new OpenSeaClient({ apiKey: this.config.getOrThrow<string>("OPENSEA_API_KEY") });

    try {
      const stats = await client.getCollectionStats(collection.slug);
      return {
        collectionId: collection.id,
        floorPriceEth: stats.floorPriceEth ?? null,
        totalVolumeEth: stats.totalVolumeEth ?? null,
        checkedAt: new Date().toISOString(),
        source: "opensea"
      };
    } catch (error) {
      return {
        collectionId: collection.id,
        floorPriceEth: null,
        totalVolumeEth: null,
        checkedAt: new Date().toISOString(),
        source: "unavailable",
        warning: error instanceof Error ? error.message : "OpenSea market stats are unavailable."
      };
    }
  }
}

class ScanByContractDto {
  @IsString()
  contractAddress!: string;

  @IsOptional()
  @IsIn(["ethereum", "base", "robinhood"])
  chain?: "ethereum" | "base" | "robinhood";
}

@Controller("collections")
@UseGuards(AuthGuard)
class CollectionsByContractController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  @Post("scan-by-contract")
  async scanByContract(@Body() body: ScanByContractDto) {
    const normalized = normalizeContractAddress(body.contractAddress);
    if (!normalized) {
      throw new BadRequestException("Enter a valid contract address (0x…).");
    }

    const chain = (body.chain ?? "ethereum") as "ethereum" | "base" | "robinhood";

    try {
      const client = new OpenSeaClient({ apiKey: this.config.getOrThrow<string>("OPENSEA_API_KEY") });
      const drop = await client.scanDropByContract(normalized, chain);
      const collection = await this.prisma.collection.upsert({
        where: { slug_chain: { slug: drop.slug, chain: chain === "base" ? "BASE" : chain === "robinhood" ? "ROBINHOOD" : "ETHEREUM" } },
        create: {
          slug: drop.slug,
          name: drop.name,
          imageUrl: drop.imageUrl,
          chain: chain === "base" ? "BASE" : chain === "robinhood" ? "ROBINHOOD" : "ETHEREUM",
          contractAddress: drop.contractAddress,
          mintPriceWei: drop.phases[0]?.priceEth ? ethToWei(drop.phases[0].priceEth) : "0",
          supply: drop.supply,
          phases: {
            create: drop.phases.map((phase: DropPhase) => ({
              phaseType: phaseTypeToPrisma(phase.type),
              name: phase.name ?? null,
              priceWei: ethToWei(phase.priceEth),
              startTime: new Date(phase.startTime),
              endTime: phase.endTime ? new Date(phase.endTime) : undefined,
              maxMint: phase.maxMintPerWallet ?? null
            }))
          }
        },
        update: {
          name: drop.name,
          imageUrl: drop.imageUrl,
          contractAddress: drop.contractAddress,
          supply: drop.supply,
          mintPriceWei: drop.phases[0]?.priceEth ? ethToWei(drop.phases[0].priceEth) : undefined,
          phases: {
            deleteMany: {},
            create: drop.phases.map((phase: DropPhase) => ({
              phaseType: phaseTypeToPrisma(phase.type),
              name: phase.name ?? null,
              priceWei: ethToWei(phase.priceEth),
              startTime: new Date(phase.startTime),
              endTime: phase.endTime ? new Date(phase.endTime) : undefined,
              maxMint: phase.maxMintPerWallet ?? null
            }))
          }
        },
        include: collectionInclude
      });
      return collection;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const message = error instanceof Error ? error.message : "Scan failed";
      throw new BadRequestException(message);
    }
  }
}

@Module({ controllers: [CollectionsController, CollectionsByContractController] })
export class CollectionsModule {}

function normalizeContractAddress(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return trimmed.toLowerCase();
  return null;
}

function extractOpenSeaAddresses(data: Record<string, unknown>): string[] {
  const candidates = [
    data.addresses, data.wallets, data.allowlist, data.entries,
    data.minters, data.eligible_addresses, data.eligible_wallets
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) {
      const addrs = c.map((item: unknown) =>
        typeof item === "string" ? item :
        typeof item === "object" && item !== null
          ? String((item as Record<string, unknown>).address ?? (item as Record<string, unknown>).wallet ?? "")
          : ""
      ).filter((a: string) => /^0x[a-fA-F0-9]{40}$/.test(a));
      if (addrs.length > 0) return addrs;
    }
  }
  return [];
}
