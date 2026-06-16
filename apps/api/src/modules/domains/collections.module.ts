import { BadRequestException, Body, Controller, Get, Module, NotFoundException, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MintPhaseType } from "@prisma/client";
import { IsArray, IsIn, IsOptional, IsString } from "class-validator";
import { OpenSeaClient, type DropPhase } from "@mint-copilot/opensea";
import { getAllowListInfo } from "@mint-copilot/blockchain";
import { decryptPrivateKey } from "@mint-copilot/wallet-crypto";
import { privateKeyToAccount } from "viem/accounts";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";

// ── Python eligibility worker (Cloudflare bypass) ────────────────────────────
// Node.js fetch is blocked by Cloudflare (TLS fingerprint mismatch).
// Python's curl_cffi spoofs Chrome TLS and passes where Node.js cannot.

function findPythonWorker(): string | null {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const candidates = [
    process.env.ELIGIBILITY_WORKER_PATH,
    path.resolve(__dirname, "../../../../../tools/eligibility_worker.py"),
    path.resolve(process.cwd(), "tools/eligibility_worker.py"),
    path.resolve(process.cwd(), "../../tools/eligibility_worker.py"),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* skip */ }
  }
  return null;
}

type PyWalletResult = { address: string; eligible: boolean; stages: string[]; error: string | null };

/** Call the Python worker in bulk mode — one subprocess for all wallets. */
function checkEligibilityViaPythonBulk(
  slug: string,
  wallets: Array<{ address: string; privkey: string }>,
  workerPath: string,
  timeoutMs = 120_000,
): Promise<PyWalletResult[]> {
  return new Promise((resolve) => {
    const pythonCmd = process.env.PYTHON_CMD ?? "python3";
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(pythonCmd, [workerPath], { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      resolve(wallets.map((w) => ({ address: w.address, eligible: false, stages: [], error: "Failed to spawn Python" })));
      return;
    }
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      proc.kill();
      resolve(wallets.map((w) => ({ address: w.address, eligible: false, stages: [], error: "Python worker timed out" })));
    }, timeoutMs);
    proc.on("close", () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed.results ?? []);
      } catch {
        const err = stderr.slice(0, 300) || "Python worker bad output";
        resolve(wallets.map((w) => ({ address: w.address, eligible: false, stages: [], error: err })));
      }
    });
    // Proxies from env (comma-separated list) or empty
    const proxies = process.env.ELIGIBILITY_PROXIES
      ? process.env.ELIGIBILITY_PROXIES.split(",").map((p) => p.trim()).filter(Boolean)
      : [];
    proc.stdin?.write(JSON.stringify({ slug, wallets, threads: 3, delay: 1.5, proxies }));
    proc.stdin?.end();
  });
}

/** Legacy single-wallet call — kept for fallback compatibility. */
function checkEligibilityViaPython(
  slug: string,
  privkey: string,
  workerPath: string
): Promise<{ eligible: boolean; stages: string[]; error: string | null }> {
  return new Promise((resolve) => {
    const pythonCmd = process.env.PYTHON_CMD ?? "python3";
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(pythonCmd, [workerPath], { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      resolve({ eligible: false, stages: [], error: "Failed to spawn Python" });
      return;
    }
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      proc.kill();
      resolve({ eligible: false, stages: [], error: "Python worker timed out" });
    }, 30_000);
    proc.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        resolve({ eligible: false, stages: [], error: stderr.slice(0, 300) || "Python worker bad output" });
      }
    });
    proc.stdin?.write(JSON.stringify({ slug, privkey }));
    proc.stdin?.end();
  });
}

const PYTHON_WORKER_PATH = findPythonWorker();
import {
  collectionInclude,
  ethToWei,
  getCollectionWithPhaseData,
  phaseTypeToPrisma,
  resolvePhaseWindows,
  toOpenSeaPhase
} from "./collection-phase.utils.js";

class ScanCollectionDto {
  @IsString()
  url!: string;
}

class EligibilityDto {
  @IsString()
  slug!: string;

  @IsString()
  walletAddress!: string;

  @IsIn(["public", "allowlist", "gtd", "fcfs"])
  phaseType!: "public" | "allowlist" | "gtd" | "fcfs";
}

class WalletEligibilityMatrixDto {
  @IsArray()
  @IsString({ each: true })
  walletIds!: string[];
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
        where: { slug_chain: { slug: drop.slug, chain: drop.chain === "base" ? "BASE" : "ETHEREUM" } },
        create: {
          slug: drop.slug,
          name: drop.name,
          imageUrl: drop.imageUrl,
          chain: drop.chain === "base" ? "BASE" : "ETHEREUM",
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

  @Post(":id/eligibility-matrix")
  async eligibilityMatrix(
    @CurrentUser() user: CurrentUserType,
    @Param("id") id: string,
    @Body() body: WalletEligibilityMatrixDto
  ) {
    const phaseData = await getCollectionWithPhaseData(this.prisma, this.config, id);
    const { collection } = phaseData;
    const walletRecords = await this.prisma.wallet.findMany({
      where: { id: { in: body.walletIds }, userId: user.id },
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

    // Decrypt all private keys upfront — used for both the Node.js SIWE signer
    // and the Python worker fallback (which needs the raw key via stdin).
    const masterKey = this.config.getOrThrow<string>("ENCRYPTION_MASTER_KEY");
    const signerByWalletId = new Map<string, (message: string) => Promise<string>>();
    const privkeyByWalletId = new Map<string, string>();
    for (const record of walletRecords) {
      try {
        const privateKey = await decryptPrivateKey(
          {
            encryptedPrivateKey: record.encryptedPrivateKey,
            encryptionSalt: record.encryptionSalt,
            encryptionIv: record.encryptionIv,
            encryptionAuthTag: record.encryptionAuthTag,
            encryptionVersion: record.encryptionVersion
          },
          { masterKey }
        ) as string;
        privkeyByWalletId.set(record.id, privateKey);
        signerByWalletId.set(record.id, async (message: string) =>
          privateKeyToAccount(privateKey as `0x${string}`).signMessage({ message })
        );
      } catch (err) {
        console.warn(`[eligibility] Could not decrypt key for wallet ${record.id}:`, err);
        // Skip this wallet — it will show as unverifiable
      }
    }
    const wallets = walletRecords.map((record) => ({ id: record.id, name: record.name, address: record.address }));

    const client = new OpenSeaClient({ apiKey: this.config.getOrThrow<string>("OPENSEA_API_KEY") });
    const phaseWindows = resolvePhaseWindows(collection.phases);

    // ── Bulk Python eligibility check (primary) ──────────────────────────────
    // Run once for all wallets upfront. Python uses curl_cffi (Chrome TLS spoof)
    // which passes Cloudflare where Node.js fetch cannot.
    // Results stored by address, used in checkPhaseForWallet below.
    const pyBulkResultByAddress = new Map<string, PyWalletResult>();
    if (PYTHON_WORKER_PATH) {
      try {
        const walletsForPython = wallets
          .map((w) => {
            const privkey = privkeyByWalletId.get(w.id);
            return privkey ? { address: w.address, privkey } : null;
          })
          .filter((w): w is { address: string; privkey: string } => w !== null);

        if (walletsForPython.length > 0) {
          const pyResults = await checkEligibilityViaPythonBulk(
            collection.slug,
            walletsForPython,
            PYTHON_WORKER_PATH,
            // Allow up to (wallets × 45 s) but cap at 110 s to stay under nginx timeout
            Math.min(walletsForPython.length * 45_000, 110_000)
          );
          for (const r of pyResults) {
            pyBulkResultByAddress.set(r.address.toLowerCase(), r);
          }
        }
      } catch (err) {
        console.warn("[eligibility] Bulk Python check threw:", err);
      }
    }

    // ── Allowlist fallback: fetch contract/OpenSea allowlist once, shared across all wallet checks ──
    // This is used when OpenSea API returns 404 for per-wallet eligibility (e.g. GTD phases).
    let allowlistAddressSet: Set<string> | null = null;
    let allowlistFetched = false;
    const getAllowlistAddressSet = async (): Promise<Set<string> | null> => {
      if (allowlistFetched) return allowlistAddressSet;
      allowlistFetched = true;
      if (!collection.contractAddress) return null;
      const network = collection.chain === "BASE" ? "base" : "ethereum";
      const rpcUrl = this.config.get<string>(network === "base" ? "BASE_RPC_PRIMARY" : "ETH_RPC_PRIMARY");
      // Try contract source first
      if (rpcUrl) {
        try {
          const contractResult = await getAllowListInfo(
            { chainName: network, rpcUrl },
            collection.contractAddress as `0x${string}`
          );
          if (contractResult.addresses.length > 0) {
            allowlistAddressSet = new Set(contractResult.addresses.map((a) => a.toLowerCase()));
            return allowlistAddressSet;
          }
        } catch { /* fall through to OpenSea allowlist */ }
      }
      // Try OpenSea allowlist endpoint
      try {
        const endpoints = [
          `/drops/${collection.slug}/allowlist?limit=10000`,
          `/drops/${collection.slug}/allowlist`,
          `/chain/${network}/contract/${collection.contractAddress}/drops/allowlist?limit=10000`,
        ];
        const extractAddresses = (data: Record<string, unknown>): string[] => {
          const candidates = [
            data["addresses"], data["wallets"], data["allowlist"], data["entries"],
            (data["result"] as Record<string, unknown>)?.["addresses"],
          ];
          for (const c of candidates) {
            if (Array.isArray(c) && c.length > 0 && typeof c[0] === "string") {
              return (c as string[]).filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a));
            }
          }
          return [];
        };
        for (const ep of endpoints) {
          try {
            const data = await (client as unknown as { request: <T>(path: string) => Promise<T> }).request<Record<string, unknown>>(ep);
            const addrs = extractAddresses(data);
            if (addrs.length > 0) {
              allowlistAddressSet = new Set(addrs.map((a) => a.toLowerCase()));
              return allowlistAddressSet;
            }
          } catch { /* try next */ }
        }
      } catch { /* OpenSea allowlist unavailable */ }
      return null;
    };

    // Run all wallet × phase eligibility checks in parallel.
    const checkPhaseForWallet = async (wallet: { id: string; name: string; address: string }, window: ReturnType<typeof resolvePhaseWindows>[number]) => {
      if (window.phaseType === "PUBLIC") {
        return {
          phaseType: window.phaseType,
          startTime: window.startTime,
          endTime: window.endTime,
          phaseStatus: window.phaseStatus,
          eligible: window.phaseStatus !== "ENDED",
          checked: true,
          reason:
            window.phaseStatus === "LIVE"
              ? "Public phase is live."
              : window.phaseStatus === "UPCOMING"
                ? `Public phase opens at ${window.startTime.toISOString()}.`
                : "Public phase has already ended."
        };
      }

      // ── Use bulk Python result (primary) if available ───────────────────────
      // Python returns stages like ["GTD#0", "ALLOWLIST#1", "FCFS#0"].
      // Match against current phaseType — e.g. "GTD" matches "GTD#0".
      const pyResult = pyBulkResultByAddress.get(wallet.address.toLowerCase());
      if (pyResult && !pyResult.error) {
        const phaseEligible = pyResult.stages.some(
          (s) => s.startsWith(window.phaseType) || s === window.phaseType
        );
        return {
          phaseType: window.phaseType,
          startTime: window.startTime,
          endTime: window.endTime,
          phaseStatus: window.phaseStatus,
          eligible: window.phaseStatus !== "ENDED" && phaseEligible,
          checked: true,
          reason: phaseEligible
            ? `Eligible for ${window.phaseType} (${pyResult.stages.join(", ")})`
            : `Not eligible for ${window.phaseType} phase.`
        };
      }

      try {
        const result = await client.checkEligibility(
          collection.slug,
          wallet.address,
          toOpenSeaPhase(window.phaseType),
          {
            chain: collection.chain.toLowerCase(),
            contractAddress: collection.contractAddress ?? undefined,
            signMessage: signerByWalletId.get(wallet.id)
          }
        );
        return {
          phaseType: window.phaseType,
          startTime: window.startTime,
          endTime: window.endTime,
          phaseStatus: window.phaseStatus,
          eligible: window.phaseStatus !== "ENDED" && result.eligible,
          checked: true,
          reason:
            result.reason ??
            (result.eligible
              ? window.phaseStatus === "LIVE"
                ? "Wallet is eligible and the phase is live."
                : "Wallet is eligible for this phase."
              : "Wallet is not eligible for this phase.")
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const is404 = msg.includes("404");

        // ── Allowlist fallback: on-chain / OpenSea allowlist ────────────────
        if (is404 && collection.contractAddress) {
          try {
            const addressSet = await getAllowlistAddressSet();
            if (addressSet !== null) {
              const eligible = addressSet.has(wallet.address.toLowerCase());
              return {
                phaseType: window.phaseType,
                startTime: window.startTime,
                endTime: window.endTime,
                phaseStatus: window.phaseStatus,
                eligible: window.phaseStatus !== "ENDED" && eligible,
                checked: true,
                reason: eligible
                  ? "Wallet found in allowlist (verified via contract/OpenSea allowlist)."
                  : "Wallet not found in allowlist."
              };
            }
          } catch { /* fall through to Python worker */ }
        }

        // ── Python worker fallback: curl_cffi Chrome TLS spoofing ───────────
        // Used when Node.js SIWE is blocked by Cloudflare and on-chain
        // allowlist is unavailable. Python passes Cloudflare where Node.js can't.
        if (PYTHON_WORKER_PATH) {
          try {
            const privkey = privkeyByWalletId.get(wallet.id);
            if (privkey) {
              const pyResult = await checkEligibilityViaPython(
                collection.slug,
                privkey,
                PYTHON_WORKER_PATH
              );
              if (!pyResult.error) {
                return {
                  phaseType: window.phaseType,
                  startTime: window.startTime,
                  endTime: window.endTime,
                  phaseStatus: window.phaseStatus,
                  eligible: window.phaseStatus !== "ENDED" && pyResult.eligible,
                  checked: true,
                  reason: pyResult.eligible
                    ? `Eligible (${pyResult.stages.join(", ")})`
                    : "Not eligible for any whitelist stage."
                };
              }
              // Python ran but returned an error — log it and fall through
              console.warn(`[eligibility] Python worker error for ${wallet.address}: ${pyResult.error}`);
            }
          } catch (pyErr) {
            console.warn(`[eligibility] Python worker threw for ${wallet.address}:`, pyErr);
          }
        }

        return {
          phaseType: window.phaseType,
          startTime: window.startTime,
          endTime: window.endTime,
          phaseStatus: window.phaseStatus,
          eligible: false,
          checked: false,
          reason: is404
            ? "Eligibility could not be verified via OpenSea API — check manually on opensea.io."
            : msg
        };
      }
    }

    // Fire all (wallet × phase) checks concurrently. Bulk Python already ran
    // upfront so most wallets will resolve instantly from pyBulkResultByAddress.
    // Keep a short deadline for the remaining OpenSea API fallback calls.
    const OVERALL_TIMEOUT_MS = 15_000;
    const deadlineResult = Symbol("deadline");
    const deadline = new Promise<typeof deadlineResult>((resolve) =>
      setTimeout(() => resolve(deadlineResult), OVERALL_TIMEOUT_MS)
    );

    const walletResultsOrTimeout = await Promise.race([
      Promise.all(
        wallets.map(async (wallet) => {
          const phases = await Promise.all(
            phaseWindows.map((window) => checkPhaseForWallet(wallet, window))
          );
          return {
            walletId: wallet.id,
            walletName: wallet.name,
            walletAddress: wallet.address,
            eligiblePhaseTypes: phases.filter((phase) => phase.eligible).map((phase) => phase.phaseType),
            unverifiablePhaseTypes: phases.filter((phase) => !phase.checked).map((phase) => phase.phaseType),
            phases
          };
        })
      ),
      deadline
    ]);

    // If we hit the deadline, return stub "unverifiable" entries so the
    // frontend shows something useful rather than a hard 504.
    const walletResults = walletResultsOrTimeout === deadlineResult
      ? wallets.map((wallet) => ({
          walletId: wallet.id,
          walletName: wallet.name,
          walletAddress: wallet.address,
          eligiblePhaseTypes: [] as typeof phaseWindows[number]["phaseType"][],
          unverifiablePhaseTypes: phaseWindows.map((w) => w.phaseType),
          phases: phaseWindows.map((window) => ({
            phaseType: window.phaseType,
            startTime: window.startTime,
            endTime: window.endTime,
            phaseStatus: window.phaseStatus,
            eligible: false,
            checked: false,
            reason: "Eligibility check timed out — OpenSea API is slow. Check manually on opensea.io."
          }))
        }))
      : walletResultsOrTimeout;

    return {
      collectionId: collection.id,
      collectionName: collection.name,
      collectionSlug: collection.slug,
      phaseSource: phaseData.phaseSource,
      phaseWarning: phaseData.phaseWarning,
      phaseCheckedAt: phaseData.phaseCheckedAt,
      phaseWindows: phaseWindows.map((window) => ({
        phaseType: window.phaseType,
        startTime: window.startTime.toISOString(),
        endTime: window.endTime?.toISOString() ?? null,
        phaseStatus: window.phaseStatus
      })),
      wallets: walletResults
    };
  }

  @Post("check-eligibility")
  async eligibility(@Body() body: EligibilityDto) {
    const client = new OpenSeaClient({ apiKey: this.config.getOrThrow<string>("OPENSEA_API_KEY") });
    return client.checkEligibility(body.slug, body.walletAddress, body.phaseType);
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

    const network = collection.chain === "BASE" ? "base" : "ethereum";
    const rpcUrl = this.config.getOrThrow<string>(
      network === "base" ? "BASE_RPC_PRIMARY" : "ETH_RPC_PRIMARY"
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
  @IsIn(["ethereum", "base"])
  chain?: "ethereum" | "base";
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

    const chain = (body.chain ?? "ethereum") as "ethereum" | "base";

    try {
      const client = new OpenSeaClient({ apiKey: this.config.getOrThrow<string>("OPENSEA_API_KEY") });
      const drop = await client.scanDropByContract(normalized, chain);
      const collection = await this.prisma.collection.upsert({
        where: { slug_chain: { slug: drop.slug, chain: chain === "base" ? "BASE" : "ETHEREUM" } },
        create: {
          slug: drop.slug,
          name: drop.name,
          imageUrl: drop.imageUrl,
          chain: chain === "base" ? "BASE" : "ETHEREUM",
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
