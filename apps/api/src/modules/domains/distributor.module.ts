import { Body, Controller, Get, Module, Param, Post, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IsArray, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { decryptPrivateKey } from "@mint-copilot/wallet-crypto";
import {
  chainByName,
  getBalance,
  signTransaction
} from "@mint-copilot/blockchain";
import { createPublicClient, http, parseEther, formatEther } from "viem";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { broadcastWithRpcPool, chainNameForNetwork, primaryRpcForNetwork } from "./rpc-failover.js";

// ─── DTOs ─────────────────────────────────────────────────────────────────────

class RecipientByIdDto {
  @IsString()
  walletId!: string;

  @IsString()
  amountEth!: string;
}

class RecipientByAddressDto {
  @IsString()
  address!: `0x${string}`;

  @IsString()
  amountEth!: string;
}

class DistributeByIdsDto {
  @IsString()
  senderWalletId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipientByIdDto)
  recipients!: RecipientByIdDto[];
}

class DistributeByAddressesDto {
  @IsString()
  senderWalletId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipientByAddressDto)
  recipients!: RecipientByAddressDto[];
}

class PreviewDto {
  @IsString()
  senderWalletId!: string;

  @IsArray()
  @IsString({ each: true })
  recipientWalletIds!: string[];

  @IsString()
  amountEthEach!: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Controller ───────────────────────────────────────────────────────────────

@Controller("distributor")
@UseGuards(AuthGuard)
class DistributorController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  /**
   * Preview — calculates what each wallet needs without sending anything.
   * Shows current balances + how much will be sent.
   */
  @Post("preview")
  async preview(@CurrentUser() user: CurrentUserType, @Body() body: PreviewDto) {
    const sender = await this.prisma.wallet.findFirstOrThrow({
      where: { id: body.senderWalletId, userId: user.id }
    });

    const recipients = await this.prisma.wallet.findMany({
      where: { id: { in: body.recipientWalletIds }, userId: user.id },
      select: { id: true, name: true, address: true, network: true, lastBalanceWei: true }
    });

    const rpcUrl = primaryRpcForNetwork(sender.network, this.config);
    const chainName = chainNameForNetwork(sender.network);

    const senderBalance = await getBalance({ chainName, rpcUrl }, sender.address as `0x${string}`);
    const amountWeiEach = parseEther(body.amountEthEach);
    const totalWei = amountWeiEach * BigInt(recipients.length);

    // Estimate gas for each transfer (~21000 units)
    const GAS_PER_TX = 21_000n;
    const client = createPublicClient({
      chain: chainByName(chainName),
      transport: http(rpcUrl)
    });
    const block = await client.getBlock();
    const baseFee = block.baseFeePerGas ?? 1_000_000_000n;
    const gasCostEach = GAS_PER_TX * (baseFee * 2n);
    const totalGasCost = gasCostEach * BigInt(recipients.length);
    const totalRequired = totalWei + totalGasCost;

    return {
      sender: {
        id: sender.id,
        name: sender.name,
        address: sender.address,
        network: sender.network,
        balanceEth: formatEther(senderBalance),
        sufficientFunds: senderBalance >= totalRequired
      },
      recipients: recipients.map((r) => ({
        id: r.id,
        name: r.name,
        address: r.address,
        currentBalanceEth: formatEther(BigInt(r.lastBalanceWei ?? "0")),
        willReceiveEth: body.amountEthEach
      })),
      summary: {
        recipientCount: recipients.length,
        amountEthEach: body.amountEthEach,
        totalDistributeEth: formatEther(totalWei),
        estimatedGasEth: formatEther(totalGasCost),
        totalRequiredEth: formatEther(totalRequired),
        senderCanAfford: senderBalance >= totalRequired
      }
    };
  }

  /**
   * Distribute — send ETH from sender wallet to wallet IDs owned by this user.
   */
  @Post("send")
  async distribute(@CurrentUser() user: CurrentUserType, @Body() body: DistributeByIdsDto) {
    const sender = await this.prisma.wallet.findFirstOrThrow({
      where: { id: body.senderWalletId, userId: user.id }
    });

    // Resolve recipient addresses (must belong to this user)
    const recipientWallets = await this.prisma.wallet.findMany({
      where: {
        id: { in: body.recipients.map((r) => r.walletId) },
        userId: user.id
      }
    });

    const recipientMap = new Map(recipientWallets.map((w) => [w.id, w]));

    // Decrypt sender private key
    const masterKey = this.config.getOrThrow<string>("ENCRYPTION_MASTER_KEY");
    const privateKey = await decryptPrivateKey(
      {
        encryptedPrivateKey: sender.encryptedPrivateKey,
        encryptionSalt: sender.encryptionSalt,
        encryptionIv: sender.encryptionIv,
        encryptionAuthTag: sender.encryptionAuthTag,
        encryptionVersion: sender.encryptionVersion
      },
      { masterKey }
    );

    const rpcUrl = primaryRpcForNetwork(sender.network, this.config);
    const chainName = chainNameForNetwork(sender.network);
    const client = createPublicClient({
      chain: chainByName(chainName),
      transport: http(rpcUrl)
    });

    // Fetch gas and nonce once
    const block = await client.getBlock();
    const baseFee = block.baseFeePerGas ?? 1_000_000_000n;
    const maxFeePerGas = baseFee * 2n + 1_500_000_000n; // base*2 + 1.5 gwei priority
    const maxPriorityFeePerGas = 1_500_000_000n;
    let nonce = await client.getTransactionCount({ address: sender.address as `0x${string}` });

    const results: Array<{
      walletId: string;
      address: string;
      amountEth: string;
      txHash?: string;
      status: "sent" | "failed";
      error?: string;
    }> = [];

    for (const recipient of body.recipients) {
      const recipientWallet = recipientMap.get(recipient.walletId);
      if (!recipientWallet) {
        results.push({ walletId: recipient.walletId, address: "unknown", amountEth: recipient.amountEth, status: "failed", error: "Wallet not found or not owned by you" });
        continue;
      }

      try {
        const value = parseEther(recipient.amountEth);
        const gas = 21_000n;

        const signedTx = await signTransaction(
          { chainName, rpcUrl },
          privateKey as `0x${string}`,
          {
            to: recipientWallet.address as `0x${string}`,
            value,
            gas,
            nonce,
            maxFeePerGas,
            maxPriorityFeePerGas
          }
        );

        const txHash = await broadcastWithRpcPool(sender.network, this.config, signedTx);
        nonce++; // increment for next tx in sequence

        results.push({
          walletId: recipient.walletId,
          address: recipientWallet.address,
          amountEth: recipient.amountEth,
          txHash,
          status: "sent"
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        results.push({
          walletId: recipient.walletId,
          address: recipientWallet.address,
          amountEth: recipient.amountEth,
          status: "failed",
          error: message
        });
      }
    }

    // Zero out private key from memory
    (privateKey as unknown as string[]).fill?.("");

    const sent = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed").length;

    return {
      summary: { total: results.length, sent, failed },
      results
    };
  }

  /**
   * Send to raw addresses (not wallet IDs) — useful for external recipients.
   */
  @Post("send-external")
  async distributeExternal(@CurrentUser() user: CurrentUserType, @Body() body: DistributeByAddressesDto) {
    const sender = await this.prisma.wallet.findFirstOrThrow({
      where: { id: body.senderWalletId, userId: user.id }
    });

    const masterKey = this.config.getOrThrow<string>("ENCRYPTION_MASTER_KEY");
    const privateKey = await decryptPrivateKey(
      {
        encryptedPrivateKey: sender.encryptedPrivateKey,
        encryptionSalt: sender.encryptionSalt,
        encryptionIv: sender.encryptionIv,
        encryptionAuthTag: sender.encryptionAuthTag,
        encryptionVersion: sender.encryptionVersion
      },
      { masterKey }
    );

    const rpcUrl = primaryRpcForNetwork(sender.network, this.config);
    const chainName = chainNameForNetwork(sender.network);
    const client = createPublicClient({
      chain: chainByName(chainName),
      transport: http(rpcUrl)
    });

    const block = await client.getBlock();
    const baseFee = block.baseFeePerGas ?? 1_000_000_000n;
    const maxFeePerGas = baseFee * 2n + 1_500_000_000n;
    const maxPriorityFeePerGas = 1_500_000_000n;
    let nonce = await client.getTransactionCount({ address: sender.address as `0x${string}` });

    const results: Array<{
      address: string;
      amountEth: string;
      txHash?: string;
      status: "sent" | "failed";
      error?: string;
    }> = [];

    for (const recipient of body.recipients) {
      try {
        const value = parseEther(recipient.amountEth);
        const signedTx = await signTransaction(
          { chainName, rpcUrl },
          privateKey as `0x${string}`,
          {
            to: recipient.address,
            value,
            gas: 21_000n,
            nonce,
            maxFeePerGas,
            maxPriorityFeePerGas
          }
        );

        const txHash = await broadcastWithRpcPool(sender.network, this.config, signedTx);
        nonce++;

        results.push({ address: recipient.address, amountEth: recipient.amountEth, txHash, status: "sent" });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        results.push({ address: recipient.address, amountEth: recipient.amountEth, status: "failed", error: message });
      }
    }

    (privateKey as unknown as string[]).fill?.("");

    const sent = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed").length;

    return { summary: { total: results.length, sent, failed }, results };
  }

  /**
   * History — sender wallet balance refresh + recent transactions context.
   */
  @Get("balance/:walletId")
  async senderBalance(@CurrentUser() user: CurrentUserType, @Param("walletId") walletId: string) {
    const wallet = await this.prisma.wallet.findFirstOrThrow({
      where: { id: walletId, userId: user.id },
      select: { id: true, name: true, address: true, network: true }
    });
    const rpcUrl = primaryRpcForNetwork(wallet.network, this.config);
    const chainName = chainNameForNetwork(wallet.network);
    const balanceWei = await getBalance({ chainName, rpcUrl }, wallet.address as `0x${string}`);
    await this.prisma.wallet.update({ where: { id: wallet.id }, data: { lastBalanceWei: balanceWei.toString() } });
    return {
      id: wallet.id,
      name: wallet.name,
      address: wallet.address,
      network: wallet.network,
      balanceEth: formatEther(balanceWei),
      balanceWei: balanceWei.toString()
    };
  }
}

@Module({ controllers: [DistributorController] })
export class DistributorModule {}
