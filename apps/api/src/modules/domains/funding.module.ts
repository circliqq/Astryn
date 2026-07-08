import { Body, Controller, Module, Post, UseGuards } from "@nestjs/common";
import { IsArray, IsIn, IsString } from "class-validator";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";

class FundingDto {
  @IsArray()
  @IsString({ each: true })
  walletIds!: string[];

  @IsString()
  requiredWeiPerWallet!: string;

  @IsIn(["BASE", "ETHEREUM", "ROBINHOOD"])
  network!: "BASE" | "ETHEREUM" | "ROBINHOOD";
}

@Controller("funding")
@UseGuards(AuthGuard)
class FundingController {
  constructor(private readonly prisma: PrismaService) {}

  @Post("calculate")
  async calculate(@CurrentUser() user: CurrentUserType, @Body() body: FundingDto) {
    const wallets = await this.prisma.wallet.findMany({ where: { id: { in: body.walletIds }, userId: user.id } });
    const items = wallets.map((wallet) => {
      const current = BigInt(wallet.lastBalanceWei ?? "0");
      const required = BigInt(body.requiredWeiPerWallet);
      return {
        walletId: wallet.id,
        address: wallet.address,
        requiredWei: current >= required ? "0" : (required - current).toString(),
        reason: current >= required ? "Funded" : "Needs ETH for mint plus gas"
      };
    });
    return { items, totalRequiredWei: items.reduce((sum, item) => sum + BigInt(item.requiredWei), 0n).toString() };
  }

  @Post("create-plan")
  async createPlan(@CurrentUser() user: CurrentUserType, @Body() body: FundingDto) {
    const calculated = await this.calculate(user, body);
    return this.prisma.fundingPlan.create({
      data: {
        userId: user.id,
        network: body.network,
        totalRequiredWei: calculated.totalRequiredWei,
        items: {
          create: calculated.items
            .filter((item) => BigInt(item.requiredWei) > 0n)
            .map((item) => ({ walletId: item.walletId, requiredWei: item.requiredWei, reason: item.reason }))
        }
      },
      include: { items: true }
    });
  }

  @Post("execute")
  execute() {
    return {
      ok: false,
      message: "Funding execution requires explicit treasury wallet configuration and is disabled by default."
    };
  }
}

@Module({ controllers: [FundingController] })
export class FundingModule {}
