import { Body, Controller, Get, Module, Post, UseGuards } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller("security-audit")
@UseGuards(AuthGuard)
class SecurityAuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserType) {
    return this.prisma.securityAuditLog.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100
    });
  }

  @Post()
  create(@CurrentUser() user: CurrentUserType, @Body() body: { action: string; metadata?: Prisma.InputJsonObject }) {
    return this.prisma.securityAuditLog.create({
      data: {
        userId: user.id,
        action: body.action,
        metadataJson: body.metadata ?? ({} as Prisma.InputJsonObject)
      }
    });
  }
}

@Module({ controllers: [SecurityAuditController] })
export class SecurityAuditModule {}
