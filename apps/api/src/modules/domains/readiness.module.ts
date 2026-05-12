import { Body, Controller, Module, Post, UseGuards } from "@nestjs/common";
import { calculateReadinessScore } from "@mint-copilot/shared";
import { AuthGuard } from "../auth/auth.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";

class ReadinessDto {
  mintTaskId!: string;
  walletId!: string;
  walletFunded!: boolean;
  eligible!: boolean;
  simulationPassed!: boolean;
  gasUnderCap!: boolean;
  rpcHealthy!: boolean;
  nonceClean!: boolean;
  contractLowRisk!: boolean;
}

@Controller("readiness")
@UseGuards(AuthGuard)
class ReadinessController {
  constructor(private readonly prisma: PrismaService) {}

  @Post("calculate")
  calculate(@Body() body: ReadinessDto) {
    const result = calculateReadinessScore(body);
    return this.prisma.readinessScore.create({
      data: {
        mintTaskId: body.mintTaskId,
        walletId: body.walletId,
        score: result.score,
        level: result.level,
        breakdownJson: result.breakdown,
        blockersJson: result.blockers,
        warningsJson: result.warnings
      }
    });
  }
}

@Module({ controllers: [ReadinessController] })
export class ReadinessModule {}
