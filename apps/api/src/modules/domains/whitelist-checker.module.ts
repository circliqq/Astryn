import { BadRequestException, Body, Controller, Module, Post, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IsArray, IsOptional, IsString } from "class-validator";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
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

interface PreparedWallet {
  walletId: string;
  walletName: string;
  walletAddress: string;
  privateKey: `0x${string}`;
}

interface PythonStage {
  stage?: string;
  stageType?: string;
  stageIndex?: number | null;
  maxMint?: number;
}

interface PythonWalletResult {
  address?: string;
  eligible?: boolean;
  stages?: Array<string | PythonStage>;
  error?: string | null;
}

interface PythonBulkResult {
  results?: PythonWalletResult[];
  error?: string | null;
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

function stageFromPython(stage: string | PythonStage): DropEligibilityStage {
  if (typeof stage !== "string") {
    const stageType = stage.stageType ?? stage.stage ?? "UNKNOWN";
    return {
      stage: stage.stage ?? stageType,
      stageType,
      stageIndex: typeof stage.stageIndex === "number" ? stage.stageIndex : null,
      maxMint: typeof stage.maxMint === "number" ? stage.maxMint : 0
    };
  }

  const [stageType, index] = stage.split("#");
  const stageIndex = index === undefined ? Number.NaN : Number.parseInt(index, 10);
  return {
    stage,
    stageType,
    stageIndex: Number.isFinite(stageIndex) ? stageIndex : null,
    maxMint: 0
  };
}

function findPythonWorker() {
  const candidates = [
    process.env.ELIGIBILITY_WORKER_PATH,
    path.resolve(process.cwd(), "tools", "eligibility_worker.py"),
    path.resolve(process.cwd(), "..", "..", "tools", "eligibility_worker.py"),
    "/tools/eligibility_worker.py"
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function pythonCommandCandidates(config: ConfigService) {
  return [
    process.env.PYTHON_CMD,
    config.get<string>("PYTHON_CMD"),
    "python3",
    "python"
  ].filter(Boolean) as string[];
}

function readProxyList(config: ConfigService) {
  const raw = process.env.ELIGIBILITY_PROXIES ?? config.get<string>("ELIGIBILITY_PROXIES") ?? "";
  return raw
    .split(/[\n,]+/)
    .map((proxy) => proxy.trim())
    .filter(Boolean);
}

async function runPythonWorker(
  config: ConfigService,
  payload: Record<string, unknown>,
  timeoutMs = 180_000
): Promise<PythonBulkResult | null> {
  const workerPath = findPythonWorker();
  if (!workerPath) return null;

  let lastError: unknown = null;
  for (const command of pythonCommandCandidates(config)) {
    try {
      return await new Promise<PythonBulkResult>((resolve, reject) => {
        const child = spawn(command, [workerPath], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("Whitelist checker timed out."));
        }, timeoutMs);

        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", () => {
          clearTimeout(timer);
          try {
            const parsed = JSON.parse(stdout || "{}") as PythonBulkResult;
            resolve(parsed);
          } catch {
            reject(new Error(stderr.trim() || stdout.trim() || "Whitelist checker returned invalid JSON."));
          }
        });

        child.stdin.end(JSON.stringify(payload));
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
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

    const masterKey = this.config.getOrThrow<string>("ENCRYPTION_MASTER_KEY");

    const preparedWallets = await mapLimit(wallets, 5, async (wallet): Promise<PreparedWallet> => {
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
      return {
        walletId: wallet.id,
        walletName: wallet.name,
        walletAddress: account.address,
        privateKey
      };
    });

    const pythonResult = await runPythonWorker(this.config, {
      slug,
      wallets: preparedWallets.map((wallet) => ({
        address: wallet.walletAddress,
        privkey: wallet.privateKey
      })),
      threads: 1,
      delay: 2.5,
      proxies: readProxyList(this.config)
    });

    let results: WalletCheckResult[] | null = null;
    if (pythonResult?.results) {
      const byAddress = new Map(
        pythonResult.results.map((result) => [(result.address ?? "").toLowerCase(), result])
      );
      results = preparedWallets.map((wallet) => {
        const checked = byAddress.get(wallet.walletAddress.toLowerCase());
        const stages = (checked?.stages ?? []).map(stageFromPython);
        return {
          walletId: wallet.walletId,
          walletName: wallet.walletName,
          walletAddress: wallet.walletAddress,
          eligible: !checked?.error && stages.length > 0,
          stages,
          error: checked?.error ?? null
        };
      });
    }

    if (!results) {
      const client = new OpenSeaClient({ apiKey: this.config.getOrThrow<string>("OPENSEA_API_KEY") });
      results = await mapLimit(preparedWallets, 1, async (wallet): Promise<WalletCheckResult> => {
        try {
          const account = privateKeyToAccount(wallet.privateKey);
          const checked = await client.checkDropEligibilityStages(
            slug,
            account.address,
            (message) => account.signMessage({ message })
          );

          return {
            walletId: wallet.walletId,
            walletName: wallet.walletName,
            walletAddress: wallet.walletAddress,
            eligible: checked.stages.length > 0,
            stages: checked.stages,
            error: null
          };
        } catch (error) {
          return {
            walletId: wallet.walletId,
            walletName: wallet.walletName,
            walletAddress: wallet.walletAddress,
            eligible: false,
            stages: [],
            error: error instanceof Error ? error.message : String(error)
          };
        }
      });
    }

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
