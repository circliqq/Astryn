import { Controller, Get, Module, Param, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller("transactions")
@UseGuards(AuthGuard)
class TransactionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(":id")
  get(@Param("id") id: string) {
    return this.prisma.transaction.findUniqueOrThrow({ where: { id } });
  }
}

@Module({ controllers: [TransactionsController] })
export class TransactionsModule {}
