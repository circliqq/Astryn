import { Controller, Get, Module, Param, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller("logs")
@UseGuards(AuthGuard)
class LogsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("tasks/:taskId")
  list(@Param("taskId") taskId: string) {
    return this.prisma.taskLog.findMany({ where: { mintTaskId: taskId }, orderBy: { createdAt: "asc" } });
  }

  /**
   * Returns simulation error details for the most recent FAILED mint task.
   * Surfaces the rawError field that is otherwise only visible in the DB.
   * GET /logs/sim-errors/latest
   */
  @Get("sim-errors/latest")
  async latestSimErrors(@CurrentUser() user: CurrentUserType) {
    const task = await this.prisma.mintTask.findFirst({
      where: { userId: user.id, status: "FAILED" },
      orderBy: { updatedAt: "desc" },
    });

    if (!task) return { task: null, simErrors: [] };

    const simErrors = await this.prisma.taskLog.findMany({
      where: {
        mintTaskId: task.id,
        message: { contains: "Simulation" },
      },
      orderBy: { createdAt: "asc" },
    });

    return {
      task: { id: task.id, collectionId: task.collectionId, failedAt: task.updatedAt },
      simErrors: simErrors.map((l) => ({
        level: l.level,
        message: l.message,
        rawError: (l.contextJson as Record<string, unknown> | null)?.rawError ?? null,
        createdAt: l.createdAt,
      })),
    };
  }
}

@Module({ controllers: [LogsController] })
export class LogsModule {}
