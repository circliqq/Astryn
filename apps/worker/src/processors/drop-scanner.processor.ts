/**
 * Live Drop Scanner
 * ---------------------------------------------------------------------------
 * Auto-discovers NFT collections about to mint and scores them for scam risk.
 *
 *  • On-chain: polls the SeaDrop contract for `PublicDropUpdated` logs on
 *    Ethereum + Base — fired when a collection configures/updates its public
 *    drop (i.e. it's about to mint). Gives the nftContract + price + start time.
 *  • OpenSea: enriches each drop (slug, name, image, verified/safelist, socials,
 *    supply) and computes a 0–100 risk score with human-readable flags.
 *
 * Results are written to the global `ScannedDrop` feed. Run periodically.
 */
import type { PrismaClient, Network } from "@prisma/client";
import { createMintPublicClient } from "@mint-copilot/blockchain";
import { OpenSeaClient } from "@mint-copilot/opensea";
import { logger } from "@mint-copilot/logger";
import { getAddress, parseAbiItem, zeroAddress, type Address } from "viem";

const SEADROP_ADDRESS = "0x00005EA00Ac477B1030CE78506496e8C2dE24bf5" as Address;

// First-run backfill (chunked) + per-chunk max range (RPC getLogs friendly).
const FIRST_RUN_BACKFILL = 60_000n; // ~a few days of blocks on first run
const MAX_RANGE = 9_000n;

const PUBLIC_DROP_UPDATED_ABI = parseAbiItem(
  "event PublicDropUpdated(address indexed nftContract, (uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients) publicDrop)",
);

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);

const ERC721_META_ABI = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

// Approx blocks in a 5-minute window per chain (ETH ~12s, Base ~2s).
const BLOCKS_5M: Record<"ethereum" | "base", bigint> = { ethereum: 25n, base: 150n };
// Max live drops to refresh metrics for per cycle (limits RPC + OpenSea load).
const MAX_LIVE_REFRESH = 40;

interface ChainScan {
  network: Network;
  chainName: "ethereum" | "base";
}

const CHAINS: ChainScan[] = [
  { network: "ETHEREUM", chainName: "ethereum" },
  { network: "BASE", chainName: "base" },
];

export async function scanDrops(prisma: PrismaClient): Promise<{ found: number }> {
  let totalFound = 0;
  const openSea = new OpenSeaClient({ apiKey: process.env.OPENSEA_API_KEY ?? "" });

  for (const { network, chainName } of CHAINS) {
    const rpcUrl = rpcUrlFor(chainName);
    if (!rpcUrl) {
      logger.warn({ chainName }, "drop-scanner: no RPC configured, skipping chain");
      continue;
    }

    try {
      const client = createMintPublicClient({ chainName, rpcUrl });
      const latest = await client.getBlockNumber();

      const cursor = await prisma.scannerCursor.findUnique({ where: { chain: network } });
      let fromBlock = cursor
        ? BigInt(cursor.lastBlock) + 1n
        : latest > FIRST_RUN_BACKFILL
          ? latest - FIRST_RUN_BACKFILL
          : 0n;
      if (fromBlock > latest) {
        await upsertCursor(prisma, network, latest);
        continue;
      }

      // Scan in chunks (first run backfills several days; later runs do ~1 chunk).
      let cur = fromBlock;
      let chainFound = 0;
      while (cur <= latest) {
        const end = cur + MAX_RANGE > latest ? latest : cur + MAX_RANGE;
        let logs;
        try {
          logs = await client.getLogs({
            address: SEADROP_ADDRESS,
            event: PUBLIC_DROP_UPDATED_ABI,
            fromBlock: cur,
            toBlock: end,
          });
        } catch (err) {
          logger.warn({ chainName, error: errMsg(err), from: cur.toString(), to: end.toString() }, "drop-scanner: getLogs failed");
          break;
        }

        for (const log of logs) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const args = (log as any).args ?? {};
          const nftContract = args.nftContract as string | undefined;
          const drop = args.publicDrop as
            | {
                mintPrice: bigint;
                startTime: bigint | number;
                endTime: bigint | number;
                maxTotalMintableByWallet: bigint | number;
              }
            | undefined;
          if (!nftContract || !drop) continue;

          const contract = getAddress(nftContract);
          const startMs = Number(drop.startTime) * 1000;
          const endMs = Number(drop.endTime) * 1000;
          const priceWei = (drop.mintPrice ?? 0n).toString();
          const maxPerWallet = Number(drop.maxTotalMintableByWallet ?? 0) || null;

          await enrichAndUpsert(prisma, openSea, client, {
            network,
            chainName,
            contract,
            startMs,
            endMs,
            priceWei,
            maxPerWallet,
          });
          chainFound++;
          totalFound++;
        }

        await upsertCursor(prisma, network, end);
        cur = end + 1n;
      }

      logger.info({ chainName, found: chainFound, latest: latest.toString() }, "drop-scanner: scan cycle done");
    } catch (error) {
      logger.warn({ chainName, error: errMsg(error) }, "drop-scanner: chain scan failed");
    }
  }

  // Refresh status (upcoming → live → ended) based on current time.
  await refreshStatuses(prisma);

  // Refresh live drops' velocity + supply + market (capped).
  await refreshLiveMetrics(prisma, openSea);

  return { found: totalFound };
}

type ScanClient = ReturnType<typeof createMintPublicClient>;

async function readOnchainMeta(
  client: ScanClient,
  contract: Address,
): Promise<{ symbol?: string; supply?: number; maxSupply?: number }> {
  const out: { symbol?: string; supply?: number; maxSupply?: number } = {};
  try {
    out.symbol = (await client.readContract({
      address: contract,
      abi: ERC721_META_ABI,
      functionName: "symbol",
    })) as string;
  } catch {
    /* ignore */
  }
  try {
    out.supply = Number(
      await client.readContract({ address: contract, abi: ERC721_META_ABI, functionName: "totalSupply" }),
    );
  } catch {
    /* ignore */
  }
  try {
    out.maxSupply = Number(
      await client.readContract({ address: contract, abi: ERC721_META_ABI, functionName: "maxSupply" }),
    );
  } catch {
    /* ignore */
  }
  return out;
}

async function computeVelocity(
  client: ScanClient,
  chainName: "ethereum" | "base",
  contract: Address,
): Promise<{ mints5m: number; minters5m: number }> {
  try {
    const latest = await client.getBlockNumber();
    const window = BLOCKS_5M[chainName];
    const fromBlock = latest > window ? latest - window : 0n;
    const logs = await client.getLogs({
      address: contract,
      event: TRANSFER_EVENT,
      args: { from: zeroAddress },
      fromBlock,
      toBlock: latest,
    });
    const minters = new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      logs.map((l: any) => String(l.args?.to ?? "").toLowerCase()).filter(Boolean),
    );
    return { mints5m: logs.length, minters5m: minters.size };
  } catch {
    return { mints5m: 0, minters5m: 0 };
  }
}

async function refreshLiveMetrics(prisma: PrismaClient, openSea: OpenSeaClient): Promise<void> {
  let live: Array<{ id: string; chain: Network; contractAddress: string; slug: string | null }>;
  try {
    live = await prisma.scannedDrop.findMany({
      where: { status: "live" },
      orderBy: { lastSeenAt: "desc" },
      take: MAX_LIVE_REFRESH,
      select: { id: true, chain: true, contractAddress: true, slug: true },
    });
  } catch {
    return;
  }

  const clients = new Map<string, ScanClient>();
  const clientFor = (chainName: "ethereum" | "base"): ScanClient | null => {
    if (clients.has(chainName)) return clients.get(chainName)!;
    const rpcUrl = rpcUrlFor(chainName);
    if (!rpcUrl) return null;
    const c = createMintPublicClient({ chainName, rpcUrl });
    clients.set(chainName, c);
    return c;
  };

  for (const d of live) {
    const chainName = d.chain === "BASE" ? "base" : "ethereum";
    const client = clientFor(chainName);
    if (!client) continue;
    const contract = getAddress(d.contractAddress);
    const vel = await computeVelocity(client, chainName, contract);
    const meta = await readOnchainMeta(client, contract);
    let market: Awaited<ReturnType<OpenSeaClient["getCollectionMarket"]>> = {};
    if (d.slug) {
      try {
        market = await openSea.getCollectionMarket(d.slug);
      } catch {
        /* ignore */
      }
    }
    try {
      await prisma.scannedDrop.update({
        where: { id: d.id },
        data: {
          mints5m: vel.mints5m,
          minters5m: vel.minters5m,
          supply: meta.supply ?? undefined,
          maxSupply: meta.maxSupply ?? undefined,
          symbol: meta.symbol ?? undefined,
          floorEth: market.floorEth ?? undefined,
          topOfferEth: market.topOfferEth ?? undefined,
          volume24hEth: market.volume24hEth ?? undefined,
          salesCount: market.salesCount ?? undefined,
          holders: market.holders ?? undefined,
          lastSeenAt: new Date(),
        },
      });
    } catch {
      /* ignore */
    }
  }
}

interface DropInput {
  network: Network;
  chainName: "ethereum" | "base";
  contract: Address;
  startMs: number;
  endMs: number;
  priceWei: string;
  maxPerWallet: number | null;
}

async function enrichAndUpsert(
  prisma: PrismaClient,
  openSea: OpenSeaClient,
  client: ScanClient,
  d: DropInput,
): Promise<void> {
  // OpenSea enrichment (best-effort).
  let slug: string | null = null;
  let name: string | undefined;
  let imageUrl: string | undefined;
  let supply: number | undefined;
  let verified = false;
  let hasTwitter = false;
  let hasDiscord = false;
  let hasWebsite = false;
  let source = "onchain";

  try {
    slug = await openSea.slugByContract(d.contract, d.chainName);
    if (slug) {
      const trust = await openSea.getCollectionTrust(slug);
      verified = trust.verified;
      hasTwitter = trust.hasTwitter;
      hasDiscord = trust.hasDiscord;
      hasWebsite = trust.hasWebsite;
      name = trust.name;
      imageUrl = trust.imageUrl;
      supply = trust.supply;
      source = "both";
    }
  } catch {
    // OpenSea unavailable — keep on-chain-only data.
  }

  // On-chain meta + velocity + market (best-effort).
  const meta = await readOnchainMeta(client, d.contract);
  const vel = await computeVelocity(client, d.chainName, d.contract);
  let market: Awaited<ReturnType<OpenSeaClient["getCollectionMarket"]>> = {};
  if (slug) {
    try {
      market = await openSea.getCollectionMarket(slug);
    } catch {
      /* ignore */
    }
  }
  if (meta.supply !== undefined) supply = meta.supply;

  const { score, level, flags } = scoreRisk({
    verified,
    hasTwitter,
    hasDiscord,
    hasWebsite,
    supply,
    priceWei: d.priceWei,
    startMs: d.startMs,
    hasSlug: Boolean(slug),
  });

  const startTime = d.startMs > 0 ? new Date(d.startMs) : null;
  const endTime = d.endMs > 0 ? new Date(d.endMs) : null;
  const status = computeStatus(d.startMs, d.endMs);

  await prisma.scannedDrop.upsert({
    where: { contractAddress_chain: { contractAddress: d.contract, chain: d.network } },
    create: {
      chain: d.network,
      contractAddress: d.contract,
      slug,
      name,
      imageUrl,
      symbol: meta.symbol,
      source,
      publicStartTime: startTime,
      publicEndTime: endTime,
      publicPriceWei: d.priceWei,
      maxPerWallet: d.maxPerWallet,
      supply,
      maxSupply: meta.maxSupply,
      holders: market.holders,
      floorEth: market.floorEth,
      topOfferEth: market.topOfferEth,
      volume24hEth: market.volume24hEth,
      salesCount: market.salesCount,
      mints5m: vel.mints5m,
      minters5m: vel.minters5m,
      deployedAt: new Date(),
      verified,
      hasTwitter,
      hasDiscord,
      hasWebsite,
      riskScore: score,
      riskLevel: level,
      riskFlags: flags,
      status,
    },
    update: {
      slug: slug ?? undefined,
      name: name ?? undefined,
      imageUrl: imageUrl ?? undefined,
      symbol: meta.symbol ?? undefined,
      source,
      publicStartTime: startTime,
      publicEndTime: endTime,
      publicPriceWei: d.priceWei,
      maxPerWallet: d.maxPerWallet,
      supply: supply ?? undefined,
      maxSupply: meta.maxSupply ?? undefined,
      holders: market.holders ?? undefined,
      floorEth: market.floorEth ?? undefined,
      topOfferEth: market.topOfferEth ?? undefined,
      volume24hEth: market.volume24hEth ?? undefined,
      salesCount: market.salesCount ?? undefined,
      mints5m: vel.mints5m,
      minters5m: vel.minters5m,
      verified,
      hasTwitter,
      hasDiscord,
      hasWebsite,
      riskScore: score,
      riskLevel: level,
      riskFlags: flags,
      status,
      lastSeenAt: new Date(),
    },
  });
}

// ── Risk scoring (higher = riskier) ──────────────────────────────────────────
function scoreRisk(i: {
  verified: boolean;
  hasTwitter: boolean;
  hasDiscord: boolean;
  hasWebsite: boolean;
  supply?: number;
  priceWei: string;
  startMs: number;
  hasSlug: boolean;
}): { score: number; level: "LOW" | "MEDIUM" | "HIGH"; flags: string[] } {
  let score = 0;
  const flags: string[] = [];

  if (i.verified) {
    score -= 40;
    flags.push("OpenSea verified");
  } else {
    score += 30;
    flags.push("Not OpenSea verified");
  }

  if (!i.hasSlug) {
    score += 25;
    flags.push("Not listed on OpenSea");
  }

  const socials = [i.hasTwitter, i.hasDiscord, i.hasWebsite].filter(Boolean).length;
  if (socials === 0) {
    score += 25;
    flags.push("No social links");
  } else if (socials === 1) {
    score += 10;
    flags.push("Only one social link");
  }

  const supply = i.supply ?? 0;
  if (supply === 0) {
    score += 10;
    flags.push("Unknown supply");
  } else if (supply > 100_000) {
    score += 15;
    flags.push("Very large supply");
  }

  let price = 0n;
  try {
    price = BigInt(i.priceWei);
  } catch {
    /* ignore */
  }
  if (price === 0n) {
    score += 10;
    flags.push("Free mint");
  }

  if (i.startMs > 0 && i.startMs < Date.now() - 7 * 24 * 3600 * 1000) {
    score += 10;
    flags.push("Drop start is in the past");
  }

  // Clamp 0–100
  score = Math.max(0, Math.min(100, score));
  const level = score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";
  return { score, level, flags };
}

function computeStatus(startMs: number, endMs: number): string {
  const now = Date.now();
  if (endMs > 0 && now > endMs) return "ended";
  if (startMs > 0 && now >= startMs) return "live";
  return "upcoming";
}

async function refreshStatuses(prisma: PrismaClient): Promise<void> {
  const now = new Date();
  try {
    // upcoming → live
    await prisma.scannedDrop.updateMany({
      where: { status: "upcoming", publicStartTime: { lte: now } },
      data: { status: "live" },
    });
    // live → ended
    await prisma.scannedDrop.updateMany({
      where: { status: "live", publicEndTime: { lte: now, not: null } },
      data: { status: "ended" },
    });
  } catch {
    /* non-fatal */
  }
}

async function upsertCursor(prisma: PrismaClient, chain: Network, block: bigint): Promise<void> {
  await prisma.scannerCursor.upsert({
    where: { chain },
    create: { chain, lastBlock: block.toString() },
    update: { lastBlock: block.toString() },
  });
}

function rpcUrlFor(network: "base" | "ethereum"): string | undefined {
  const prefix = network === "base" ? "BASE" : "ETH";
  return (
    process.env[`${prefix}_RPC_PRIMARY`] ??
    process.env[`${prefix}_RPC_BACKUP_1`] ??
    process.env[`${prefix}_RPC_BACKUP_2`]
  );
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
