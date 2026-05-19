import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IsOptional, IsString } from "class-validator";
import { keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { EventsGateway } from "../events/events.gateway.js";
import { EventsModule } from "../events/events.module.js";
import { PrismaService } from "../prisma/prisma.service.js";

class CreateBundleDto {
  @IsString()
  mintTaskId!: string;

  @IsOptional()
  @IsString()
  targetBlock?: string;
}

@Controller("bundles")
@UseGuards(AuthGuard)
class BundlerController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: EventsGateway,
  ) {}

  @Post()
  async create(@CurrentUser() user: CurrentUserType, @Body() body: CreateBundleDto) {
    const task = await this.prisma.mintTask.findFirst({
      where: { id: body.mintTaskId, userId: user.id },
      include: { transactions: true, collection: true },
    });
    if (!task) throw new NotFoundException("Mint task not found.");

    const signedTxs = task.transactions
      .filter((tx) => tx.status !== "FAILED")
      .map((tx) => tx.txHash)
      .filter(Boolean) as string[];

    if (signedTxs.length === 0) {
      throw new BadRequestException("No broadcastable transactions found on this mint task.");
    }

    const network = task.collection.chain;
    const bundle = await this.prisma.txBundle.create({
      data: {
        userId: user.id,
        mintTaskId: task.id,
        network,
        txCount: signedTxs.length,
        targetBlock: body.targetBlock,
        status: "PENDING",
      },
    });

    // Submit to Flashbots relay asynchronously
    void this.submitBundle(bundle.id, network, signedTxs, body.targetBlock).catch(() => undefined);

    this.events.publish("bundle.status.changed", { bundleId: bundle.id, userId: user.id, status: "PENDING" });
    return bundle;
  }

  @Get()
  list(@CurrentUser() user: CurrentUserType) {
    return this.prisma.txBundle.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
  }

  @Get(":id")
  async get(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    const bundle = await this.prisma.txBundle.findFirst({ where: { id, userId: user.id } });
    if (!bundle) throw new NotFoundException("Bundle not found.");
    return bundle;
  }

  private async submitBundle(
    bundleId: string,
    network: "BASE" | "ETHEREUM",
    signedTxs: string[],
    targetBlock?: string,
  ) {
    try {
      let bundleHash: string | null = null;

      if (network === "ETHEREUM") {
        // Ethereum: use Flashbots eth_sendBundle — targets a specific block for
        // guaranteed inclusion attempt. Requires X-Flashbots-Signature auth header.
        const authKey = this.config.get<string>("ETH_FLASHBOTS_AUTH_KEY") as Hex | undefined;
        if (!authKey) throw new Error("ETH_FLASHBOTS_AUTH_KEY is not configured.");

        const blockParam = targetBlock ? { blockNumber: targetBlock } : {};
        const body = JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_sendBundle",
          params: [{ txs: signedTxs, ...blockParam }],
        });

        // Sign the body hash — required by Flashbots relay to prevent spoofing.
        const account = privateKeyToAccount(authKey);
        const sig = await account.signMessage({ message: { raw: keccak256(toBytes(body)) } });
        const authHeader = `${account.address}:${sig}`;

        const res = await fetch("https://relay.flashbots.net", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Flashbots-Signature": authHeader,
          },
          body,
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText);
          throw new Error(`Flashbots relay responded with ${res.status}: ${text}`);
        }
        const data = (await res.json()) as { result?: { bundleHash?: string }; error?: { message?: string } };
        if (data.error) throw new Error(data.error.message ?? "Flashbots relay returned an error.");
        bundleHash = data.result?.bundleHash ?? null;

      } else {
        // Base: OP Stack sequencer — eth_sendBundle is not supported.
        // Fastest landing = parallel eth_sendRawTransaction to multiple
        // well-connected Base endpoints so the sequencer sees the tx ASAP.
        const BASE_FAST_ENDPOINTS = [
          "https://mainnet.base.org",           // official Base RPC
          "https://base.publicnode.com",         // PublicNode
          "https://base.drpc.org",               // dRPC
          "https://1rpc.io/base",                // 1RPC
          "https://rpc.flashbots.net/fast",      // Flashbots Protect (Base-aware)
        ];

        const results = await Promise.allSettled(
          signedTxs.flatMap((tx) =>
            BASE_FAST_ENDPOINTS.map(async (url) => {
              const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [tx] }),
                signal: AbortSignal.timeout(3_000),
              });
              const data = (await res.json()) as { result?: string; error?: { message?: string } };
              if (data.error && !/already known|known transaction/i.test(data.error.message ?? "")) {
                throw new Error(data.error.message ?? "RPC error");
              }
              return data.result ?? null;
            }),
          ),
        );

        // Use first successful tx hash as the bundle identifier.
        const firstHash = results.find((r) => r.status === "fulfilled" && r.value);
        bundleHash = firstHash?.status === "fulfilled" ? firstHash.value : null;

        if (results.every((r) => r.status === "rejected")) {
          throw new Error("All Base RPC endpoints rejected the transaction.");
        }
      }

      const updated = await this.prisma.txBundle.update({
        where: { id: bundleId },
        data: { status: "SUBMITTED", bundleHash },
      });
      this.events.publish("bundle.status.changed", { bundleId, userId: updated.userId, status: "SUBMITTED", bundleHash });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const updated = await this.prisma.txBundle.update({
        where: { id: bundleId },
        data: { status: "FAILED", errorMessage: msg },
      });
      this.events.publish("bundle.status.changed", { bundleId, userId: updated.userId, status: "FAILED", error: msg });
    }
  }
}

@Module({ imports: [EventsModule], controllers: [BundlerController] })
export class BundlerModule {}
