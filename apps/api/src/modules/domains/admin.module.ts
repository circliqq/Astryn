import { Controller, Get, Module, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller("admin")
@UseGuards(AuthGuard)
class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("overview")
  async overview() {
    const [users, wallets, tasks, rpcEndpoints] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.wallet.count(),
      this.prisma.mintTask.count(),
      this.prisma.rpcEndpoint.count()
    ]);
    return { users, wallets, tasks, rpcEndpoints };
  }
}

@Module({ controllers: [AdminController] })
export class AdminModule {}
