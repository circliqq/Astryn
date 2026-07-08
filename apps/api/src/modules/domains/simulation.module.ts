import { Body, Controller, Module, Post, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { simulateTx } from "@mint-copilot/blockchain";
import { toUserFacingError } from "@mint-copilot/shared";
import { AuthGuard } from "../auth/auth.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";

class SimulationDto {
  mintTaskId!: string;
  walletId!: string;
  to!: `0x${string}`;
  data!: `0x${string}`;
  valueWei!: string;
}

@Controller("simulation")
@UseGuards(AuthGuard)
class SimulationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  @Post("run")
  async run(@Body() body: SimulationDto) {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({ where: { id: body.walletId } });
    const chainName =
      wallet.network === "BASE" ? "base" : wallet.network === "ROBINHOOD" ? "robinhood" : "ethereum";
    const rpcKey =
      chainName === "base" ? "BASE_RPC_PRIMARY" : chainName === "robinhood" ? "ROBINHOOD_RPC_PRIMARY" : "ETH_RPC_PRIMARY";
    const rpcUrl = this.config.getOrThrow<string>(rpcKey);

    try {
      const result = await simulateTx(
        { chainName, rpcUrl },
        {
          account: wallet.address as `0x${string}`,
          to: body.to,
          data: body.data,
          value: BigInt(body.valueWei)
        }
      );
      return this.prisma.simulationResult.create({
        data: {
          mintTaskId: body.mintTaskId,
          walletId: body.walletId,
          passed: true,
          estimatedGasWei: result.estimatedGas.toString()
        }
      });
    } catch (error) {
      const userError = toUserFacingError(error);
      return this.prisma.simulationResult.create({
        data: {
          mintTaskId: body.mintTaskId,
          walletId: body.walletId,
          passed: false,
          errorCode: userError.code,
          errorMessage: userError.message
        }
      });
    }
  }
}

@Module({ controllers: [SimulationController] })
export class SimulationModule {}
