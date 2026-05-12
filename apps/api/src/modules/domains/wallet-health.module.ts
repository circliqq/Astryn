import { Body, Controller, Module, Post, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IsArray, IsString } from "class-validator";
import { getBalance, getNonce } from "@mint-copilot/blockchain";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";

class WalletHealthDto {
  @IsArray()
  @IsString({ each: true })
  walletIds!: string[];
}

@Controller("wallet-health")
@UseGuards(AuthGuard)
class WalletHealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  @Post("run")
  async run(@CurrentUser() user: CurrentUserType, @Body() body: WalletHealthDto) {
    const wallets = await this.prisma.wallet.findMany({
      where: { id: { in: body.walletIds }, userId: user.id }
    });

    const results = [];
    for (const wallet of wallets) {
      const isBase = wallet.network === "BASE";
      const rpcUrl = this.config.getOrThrow<string>(isBase ? "BASE_RPC_PRIMARY" : "ETH_RPC_PRIMARY");
      const chainName = isBase ? "base" : "ethereum";
      const [balanceWei, nonce] = await Promise.all([
        getBalance({ chainName, rpcUrl }, wallet.address as `0x${string}`),
        getNonce({ chainName, rpcUrl }, wallet.address as `0x${string}`)
      ]);
      const funded = balanceWei > 0n;
      const status = funded ? "READY" : "NEED_FUNDING";
      await this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { lastBalanceWei: balanceWei.toString(), lastNonce: nonce, status }
      });
      results.push(
        await this.prisma.walletHealthCheck.create({
          data: {
            walletId: wallet.id,
            network: wallet.network,
            funded,
            nonceClean: true,
            balanceWei: balanceWei.toString(),
            nonce,
            warningsJson: funded ? [] : ["Needs funding before mint."]
          }
        })
      );
    }
    return { results };
  }
}

@Module({ controllers: [WalletHealthController] })
export class WalletHealthModule {}
