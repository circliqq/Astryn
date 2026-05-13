import { Body, Controller, Get, Module, Patch, UseGuards } from "@nestjs/common";
import { IsOptional, IsString } from "class-validator";
import { AuthGuard } from "../auth/auth.guard.js";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../auth/current-user.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  displayName?: string;
}

@Controller("users")
@UseGuards(AuthGuard)
class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("me")
  async me(@CurrentUser() user: CurrentUserType) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profile = await (this.prisma.user.findUnique as any)({
      where: { id: user.id },
      select: { id: true, email: true, displayName: true, role: true, plan: true, planExpiresAt: true }
    }) as { id: string; email: string; displayName: string | null; role: string; plan: string; planExpiresAt: Date | null } | null;
    return profile ?? user;
  }

  @Patch("me")
  updateProfile(@CurrentUser() user: CurrentUserType, @Body() body: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: user.id },
      data: { displayName: body.displayName?.trim() || null },
      select: { id: true, email: true, displayName: true, role: true }
    });
  }
}

@Module({ controllers: [UsersController] })
export class UsersModule {}
