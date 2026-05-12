import { Controller, Get, Module, Param, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller("logs")
@UseGuards(AuthGuard)
class LogsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("tasks/:taskId")
  list(@Param("taskId") taskId: string) {
    return this.prisma.taskLog.findMany({ where: { mintTaskId: taskId }, orderBy: { createdAt: "asc" } });
  }
}

@Module({ controllers: [LogsController] })
export class LogsModule {}
