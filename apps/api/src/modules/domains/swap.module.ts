import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IsIn, IsNumber, IsOptional, IsString, Min } from "class-validator";
import { decryptPrivateKey } from "@mint-copilot/wallet-crypto";
import { signTransaction } from "@mint-copilot/blockchain";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { broadcastWithRpcPool, chainNameForNetwork, primaryRpcForNetwork } from "./rpc-failover.js";

// Chain IDs for 1inch API
const CHAIN_IDS: Record<"BASE" | "ETHEREUM" | "ROBINHOOD", number> = {
  BASE: 8453,
  ETHEREUM: 1,
  ROBINHOOD: 4663,
};

// Native ETH address used by 1inch
const NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

class SwapQuoteDto {
  @IsString()
  walletId!: string;

  @IsString()
  fromToken!: string;

  @IsString()
  toToken!: string;

  @IsString()
  amountInWei!: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  slippageBps?: number;
}

class ExecuteSwapDto extends SwapQuoteDto {}

interface OneinchQuoteResponse {
  toAmount?: string;
  toTokenAmount?: string;
  estimatedGas?: number;
  error?: string;
}

interface OneinchSwapResponse {
  tx?: {
    to: string;
    data: string;
    value: string;
    gas?: number;
    gasPrice?: string;
  };
  toAmount?: string;
  toTokenAmount?: string;
  error?: string;
}

@Controller("swaps")
@UseGuards(AuthGuard)
class SwapController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Post("quote")
  async getQuote(@CurrentUser() user: CurrentUserType, @Body() body: SwapQuoteDto) {
    const wallet = await this.prisma.wallet.findFirst({ where: { id: body.walletId, userId: user.id } });
    if (!wallet) throw new NotFoundException("Wallet not found.");

    const chainId = CHAIN_IDS[wallet.network];
    const apiKey = this.config.get<string>("ONEINCH_API_KEY") ?? "";
    const slippage = ((body.slippageBps ?? 50) / 100).toFixed(2);

    const params = new URLSearchParams({
      src: body.fromToken === "ETH" ? NATIVE_ETH : body.fromToken,
      dst: body.toToken === "ETH" ? NATIVE_ETH : body.toToken,
      amount: body.amountInWei,
      slippage,
    });

    const url = `https://api.1inch.dev/swap/v5.2/${chainId}/quote?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        accept: "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new BadRequestException(`1inch quote failed: ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as OneinchQuoteResponse;
    if (data.error) throw new BadRequestException(`1inch: ${data.error}`);

    return {
      fromToken: body.fromToken,
      toToken: body.toToken,
      amountInWei: body.amountInWei,
      amountOutWei: data.toAmount ?? data.toTokenAmount ?? "0",
      estimatedGas: data.estimatedGas ?? 0,
      slippageBps: body.slippageBps ?? 50,
    };
  }

  @Post()
  async execute(@CurrentUser() user: CurrentUserType, @Body() body: ExecuteSwapDto) {
    const wallet = await this.prisma.wallet.findFirst({ where: { id: body.walletId, userId: user.id } });
    if (!wallet) throw new NotFoundException("Wallet not found.");

    const chainId = CHAIN_IDS[wallet.network];
    const apiKey = this.config.get<string>("ONEINCH_API_KEY") ?? "";
    const slippage = ((body.slippageBps ?? 50) / 100).toFixed(2);
    const rpcUrl = primaryRpcForNetwork(wallet.network, this.config);

    const params = new URLSearchParams({
      src: body.fromToken === "ETH" ? NATIVE_ETH : body.fromToken,
      dst: body.toToken === "ETH" ? NATIVE_ETH : body.toToken,
      amount: body.amountInWei,
      from: wallet.address,
      slippage,
      disableEstimate: "true",
    });

    const url = `https://api.1inch.dev/swap/v5.2/${chainId}/swap?${params.toString()}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, accept: "application/json" },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new BadRequestException(`1inch swap failed: ${text.slice(0, 200)}`);
    }

    const data = (await res.json()) as OneinchSwapResponse;
    if (data.error) throw new BadRequestException(`1inch: ${data.error}`);
    if (!data.tx) throw new BadRequestException("1inch did not return transaction data.");

    const order = await this.prisma.swapOrder.create({
      data: {
        userId: user.id,
        walletId: wallet.id,
        network: wallet.network,
        fromToken: body.fromToken,
        toToken: body.toToken,
        amountInWei: body.amountInWei,
        slippageBps: body.slippageBps ?? 50,
        status: "PENDING",
      },
    });

    try {
      const privateKey = await decryptPrivateKey(
        {
          encryptedPrivateKey: wallet.encryptedPrivateKey,
          encryptionSalt: wallet.encryptionSalt,
          encryptionIv: wallet.encryptionIv,
          encryptionAuthTag: wallet.encryptionAuthTag,
          encryptionVersion: wallet.encryptionVersion,
        },
        { masterKey: this.config.getOrThrow<string>("ENCRYPTION_MASTER_KEY") },
      );

      const chainName = chainNameForNetwork(wallet.network);
      const signedTx = await signTransaction(
        { chainName, rpcUrl },
        privateKey,
        {
          to: data.tx.to as `0x${string}`,
          data: data.tx.data as `0x${string}`,
          value: BigInt(data.tx.value ?? "0"),
          gas: data.tx.gas ? BigInt(data.tx.gas) : undefined,
        },
      );

      const txHash = await broadcastWithRpcPool(wallet.network, this.config, signedTx);
      const amountOutWei = data.toAmount ?? data.toTokenAmount ?? "0";

      const updated = await this.prisma.swapOrder.update({
        where: { id: order.id },
        data: { status: "COMPLETED", txHash, amountOutWei, completedAt: new Date() },
      });

      return updated;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await this.prisma.swapOrder.update({
        where: { id: order.id },
        data: { status: "FAILED", errorMessage: msg },
      });
      throw new BadRequestException(`Swap execution failed: ${msg}`);
    }
  }

  @Get()
  list(@CurrentUser() user: CurrentUserType) {
    return this.prisma.swapOrder.findMany({
      where: { userId: user.id },
      include: { wallet: { select: { id: true, name: true, address: true } } },
      orderBy: { createdAt: "desc" },
    });
  }
}

@Module({ controllers: [SwapController] })
export class SwapModule {}
